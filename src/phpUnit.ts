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
    diags: WooDiagnostics
): Promise<void> {
    return new Promise((resolve) => {
        node.setState(testStatesEmitter, WooSuiteState.WOO_SUITE_RUNNING);
        const command =
            vscode.workspace
                .getConfiguration('woo-test-explorer')
                .get('command') +
            ('root' !== node.id
                ? ` -- --filter ${node.label}`
                : ' --') +
            ' --colors=never';

        spawnShellWithOutput(
            command,
            (
                code: number | null,
                signal: NodeJS.Signals | null,
                stdout: string
            ) => {
                if (code && code > 2) {
                    node.setState(
                        testStatesEmitter,
                        WooSuiteState.WOO_SUITE_ERRORED
                    );
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
                }
                resolve();
            }
        );
    });
}

export function runPHPUnitSingleTest(
    node: WooTest,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics
): Promise<void> {
    return new Promise((resolve) => {
        node.setState(testStatesEmitter, WooTestState.WOO_TEST_RUNNING);

        const command =
            vscode.workspace
                .getConfiguration('woo-test-explorer')
                .get('command') +
            ' -- --filter "/' +
            node.id +
            '(\\s.*)?$/" --colors=never';

        spawnShellWithOutput(
            command,
            (
                code: number | null,
                signal: NodeJS.Signals | null,
                stdout: string
            ) => {
                if (code && code > 2) {
                    node.setState(
                        testStatesEmitter,
                        WooTestState.WOO_TEST_FAILED
                    );
                } else {
                    const result = parseNodeTestResult(node, stdout, diags);
                    node.setState(
                        testStatesEmitter,
                        result
                            ? WooTestState.WOO_TEST_FAILED
                            : WooTestState.WOO_TEST_PASSED
                    );
                }
                resolve();
            }
        );
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
    ) => void
): void {
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

    runner.stdout.setEncoding('utf8');
    runner.stdout.on('data', (chunk: any) => {
        outputChannel?.append(chunk.toString());
        stdout += chunk.toString();
    });
    runner.on('error', (chunk: any) => {
        outputChannel?.append(chunk.toString());
        stdout += chunk.toString();
    });
    runner.stderr.setEncoding('utf8');
    runner.stderr.on('data', (chunk: any) => {
        outputChannel?.append(chunk.toString());
        stdout += chunk.toString();
    });

    runner.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        outputChannel?.appendLine('Command exited with code: ' + code);
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
