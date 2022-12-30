/** External dependencies */
import * as vscode from 'vscode';
import * as cp from 'child_process';

/** Internal dependencies  */
import {
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from 'vscode-test-adapter-api';
import { WooDiagnostics } from './diagnostics';
import { WooTest, WooTestState } from './wooTest';
import { WooSuite, WooSuiteState } from './wooSuite';

let outputChannel: vscode.OutputChannel;

export function runPHPUnitTestSuite(
    node: WooSuite,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    return new Promise((resolve, reject) => {
        node.setState(testStatesEmitter, WooSuiteState.WOO_SUITE_RUNNING);
        const command =
            vscode.workspace
                .getConfiguration('woo-test-explorer')
                .get('command') +
            ('root' !== node.id ? ` --filter ${node.label}` : '') +
            ' --colors=never';

        cancellationToken.onCancellationRequested((e) => {
            reject();
        });

        spawnShellWithOutput(
            command,
            (
                code: number | null,
                signal: NodeJS.Signals | null,
                stdout: string
            ) => {
                if ((code && code > 2) || signal) {
                    node.setState(
                        testStatesEmitter,
                        WooSuiteState.WOO_SUITE_ERRORED
                    );
                    killPhpunitRunners();
                    resetNodeResults(node, testStatesEmitter, diags);
                    reject();
                } else {
                    const result = parseSuiteTestResults(
                        node,
                        stdout,
                        testStatesEmitter,
                        diags
                    );
                    node.setState(
                        testStatesEmitter,
                        result
                            ? WooSuiteState.WOO_SUITE_ERRORED
                            : WooSuiteState.WOO_SUITE_COMPLETED
                    );
                    resolve();
                }
            },
            cancellationToken
        );
    });
}

export function runPHPUnitSingleTest(
    node: WooTest,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    return new Promise((resolve, reject) => {
        node.setState(testStatesEmitter, WooTestState.WOO_TEST_RUNNING);

        cancellationToken.onCancellationRequested((e) => {
            reject();
        });

        const command =
            vscode.workspace
                .getConfiguration('woo-test-explorer')
                .get('command') +
            ' --filter "/' +
            node.id +
            '(\\s.*)?$/" --colors=never';

        spawnShellWithOutput(
            command,
            (
                code: number | null,
                signal: NodeJS.Signals | null,
                stdout: string
            ) => {
                if ((code && code > 2) || signal) {
                    node.setState(
                        testStatesEmitter,
                        WooTestState.WOO_TEST_FAILED
                    );
                    resetNodeResults(node, testStatesEmitter, diags);
                    killPhpunitRunners();
                    reject();
                } else {
                    const result = parseNodeTestResult(node, stdout, diags);
                    node.setState(
                        testStatesEmitter,
                        result
                            ? WooTestState.WOO_TEST_FAILED
                            : WooTestState.WOO_TEST_PASSED
                    );
                    resolve();
                }
            },
            cancellationToken
        );
    });
}

function killPhpunitRunners() {
    const processIds = cp.execSync(
        'ps ax | grep -i "vendor/bin/phpunit" | grep "colors=never" | awk {\'print $1\'}'
    );

    processIds
        .toLocaleString()
        .split('\n')
        .filter((c) => c)
        .map((n) => parseInt(n, 10))
        .filter((c) => c > 0)
        .forEach((element) => {
            cp.exec(`kill -9 ${element}`);
        });
}

function parseSuiteTestResults(
    node: WooSuite,
    stdout: string,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics
): boolean {
    let hasError: boolean = false;
    let result: boolean;
    for (var i = 0; i < node.children.length; i++) {
        const subnode = node.children[i];
        if (subnode instanceof WooSuite) {
            result = parseSuiteTestResults(
                subnode,
                stdout,
                testStatesEmitter,
                diags
            );
            subnode.message = stdout;
            subnode.setState(
                testStatesEmitter,
                result
                    ? WooSuiteState.WOO_SUITE_ERRORED
                    : WooSuiteState.WOO_SUITE_COMPLETED
            );
        } else {
            result = parseNodeTestResult(subnode, stdout, diags);
            subnode.message = stdout;
            subnode.setState(
                testStatesEmitter,
                result
                    ? WooTestState.WOO_TEST_FAILED
                    : WooTestState.WOO_TEST_PASSED
            );
        }
        hasError = hasError ? true : result;
    }
    return hasError;
}

function resetNodeResults(
    node: WooTest | WooSuite,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics
) {
    if (node.type === 'test') {
        node.setState(testStatesEmitter, WooTestState.WOO_TEST_PENDING);
    } else {
        node.setState(testStatesEmitter, WooSuiteState.WOO_SUITE_PENDING);
    }
    diags.clear();
}

function parseNodeTestResult(
    node: WooTest,
    stdout: string,
    diags: WooDiagnostics
): boolean {
    const regex: RegExp = new RegExp(
        '^\\d+\\)\\s[A-Za-z0-9\\\\_]+::' + node.label + '$',
        'gm'
    );
    const error: RegExpMatchArray | null = stdout.match(regex);
    if (error !== null && node.file) {
        const errorInfo: NodeError | null = getErrorSpecsForNode(node, stdout);
        if (errorInfo) {
            diags.addError(node.file, errorInfo.line, errorInfo.message);
        }
    }
    return error !== null;
}

function getErrorSpecsForNode(node: WooTest, stdout: string): NodeError | null {
    try {
        const matches = stdout
            .replace(/\r\n/g, '\n')
            .matchAll(
                new RegExp(
                    '\\d+\\).+?' + node.id + '\\W(.+?.php:(\\d+))\\n\\n',
                    'gs'
                )
            );
        const match = matches.next().value;
        return new NodeError(parseInt(match[2], 10) - 1, match[1]);
    } catch (e) {
        console.log(e);
        return null;
    }
}

function spawnShellWithOutput(
    command: string,
    callback: (
        code: number | null,
        signal: NodeJS.Signals | null,
        stdout: string
    ) => void,
    cancellationToken: vscode.CancellationToken
): void {
    console.log('Spawning new command shell');
    if (outputChannel) outputChannel.dispose();
    outputChannel = vscode.window.createOutputChannel('Woo Test Explorer');
    outputChannel.show(true);
    outputChannel.appendLine('Running command: ' + command);

    const runner = cp.spawn(command, [], {
        cwd: vscode.workspace.rootPath,
        env: process.env,
        shell: true,
        detached: true,
    });

    let stdout = '';

    cancellationToken.onCancellationRequested((e) => {
        console.log('Cancel requested');
        runner.kill();
    });

    runner.stdout.setEncoding('utf8');
    runner.stdout.on('data', (chunk: any) => {
        if (!cancellationToken.isCancellationRequested) {
            outputChannel?.append(chunk.toString());
            stdout += chunk.toString();
        }
    });
    runner.on('error', (chunk: any) => {
        if (!cancellationToken.isCancellationRequested) {
            outputChannel?.append(chunk.toString());
            stdout += chunk.toString();
        }
    });
    runner.stderr.setEncoding('utf8');
    runner.stderr.on('data', (chunk: any) => {
        if (!cancellationToken.isCancellationRequested) {
            outputChannel?.append(chunk.toString());
            stdout += chunk.toString();
        }
    });

    runner.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        outputChannel?.appendLine('');
        outputChannel?.appendLine(
            code
                ? 'Command exited with code: ' + code
                : 'Command aborted with signal: ' + signal
        );
        callback(code, signal, stdout);
    });
}

class NodeError {
    public line: number;
    public message: string;
    constructor(line: number, message: string) {
        this.line = line;
        this.message = message;
    }
}
