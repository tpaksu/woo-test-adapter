import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';

import {
    TestSuiteInfo,
    TestInfo,
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';

let outputChannel: vscode.OutputChannel | null = null;

const phpUnitTests: TestSuiteInfo = {
    type: 'suite',
    id: 'phpunit_tests',
    label: 'PHPUnit tests',
    children: [],
};

const testSuite: TestSuiteInfo = {
    type: 'suite',
    id: 'root',
    label: 'Woo Test Explorer', // the label of the root node should be the name of the testing framework
    children: [phpUnitTests],
};

export function loadTests(log: Log): Promise<TestSuiteInfo> {
    const workbenchConfig =
        vscode.workspace.getConfiguration('woo-test-explorer');

    const searchPaths: string[] = workbenchConfig.get('search.include') || [
        '**/*Test.php',
        '**/test-*.php',
    ];

    const excludePaths: string[] = workbenchConfig.get('search.exclude') || [
        '**/vendor/**',
        '**/node_modules/**',
        '.git',
        '.vscode',
    ];

    log.debug(searchPaths, excludePaths);

    return new Promise<TestSuiteInfo>((resolve) => {
        phpUnitTests.children = [];
        log.debug('Workspace folder: ' + vscode.workspace.rootPath);
        vscode.workspace
            .findFiles(
                '{' + searchPaths.join(',') + '}',
                '{' + excludePaths.join(',') + '}'
            )
            .then((uris: vscode.Uri[]) => {
                uris.sort((n1: vscode.Uri, n2: vscode.Uri) => {
                    const name1: string = n1.path.split('/').pop() || '';
                    const name2: string = n2.path.split('/').pop() || '';
                    if (name1 > name2) {
                        return 1;
                    }
                    if (name1 < name2) {
                        return -1;
                    }
                    return 0;
                }).forEach((uri: vscode.Uri) => {
                    getTestSuite(uri.path, log);
                });
                return resolve(testSuite);
            });
    });
}

export async function runTests(
    tests: string[],
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >
): Promise<void> {
    for (const suiteOrTestId of tests) {
        const node = findNode(testSuite, suiteOrTestId);
        if (node) {
            await runNode(node, testStatesEmitter);
        }
    }
}

function getTestSuite(path: string, log: Log): void {
    var data = fs.readFileSync(path);
    if (data) {
        const match: RegExpMatchArray | null = data
            .toString()
            .match(/^class (\w+)\s*(\s*extends \w+)*\s*\{/im);
        if (match) {
            log.debug(match);
            const testName: string = match[1];
            phpUnitTests.children.push({
                type: 'suite',
                id: testName,
                label: testName,
                children: getTestMethods(testName, path, log),
                file: path,
            });
        }
    }
}

function getTestMethods(parentKey: string, path: string, log: Log): TestInfo[] {
    const testsInFile: TestInfo[] = [];
    var data = fs.readFileSync(path);
    if (data) {
        for (const match of data
            .toString()
            .matchAll(/public function (test_\w+)\(/gm)) {
            const matchFound: string = match[1];
            const matchOffset: number = match['index'] || 1;
            const matchLine: number =
                match['input']?.slice(0, matchOffset).split('\n').length || 1;
            testsInFile.push({
                type: 'test',
                id: parentKey + '::' + matchFound,
                label: matchFound,
                file: path,
                line: matchLine - 1,
            });
        }
    }
    return testsInFile;
}

function findNode(
    searchNode: TestSuiteInfo | TestInfo,
    id: string
): TestSuiteInfo | TestInfo | undefined {
    if (searchNode.id === id) {
        return searchNode;
    } else if (searchNode.type === 'suite') {
        for (const child of searchNode.children) {
            const found = findNode(child, id);
            if (found) return found;
        }
    }
    return undefined;
}

async function runNode(
    node: TestSuiteInfo | TestInfo,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >
): Promise<void> {
    if (node.type === 'suite') {
        return runPHPUnitTestSuite(node, testStatesEmitter);
    } else {
        return runPHPUnitSingleTest(node, testStatesEmitter);
    }
}

async function runPHPUnitTestSuite(
    node: TestSuiteInfo,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >
): Promise<void> {
    return new Promise((resolve) => {
        testStatesEmitter.fire(<TestSuiteEvent>{
            type: 'suite',
            suite: node.id,
            state: 'running',
        });

        const command =
            vscode.workspace
                .getConfiguration('woo-test-explorer')
                .get('command') +
            ('phpunit_tests' !== node.id
                ? ` -- --filter ${node.label}`
                : '');

        spawnShellWithOutput(
            command,
            (code: number, signal: NodeJS.Signals | null, stdout: string) => {
                testStatesEmitter.fire(<TestSuiteEvent>{
                    type: 'suite',
                    suite: node.id,
                    state: code !== 0 ? 'errored' : 'completed',
                });
                resolve();
                parseSuiteTestResults(node, stdout, testStatesEmitter);
            }
        );
    });
}

async function parseSuiteTestResults(
    node: TestSuiteInfo,
    stdout: string,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >
) {
    node.children.forEach((subnode: TestSuiteInfo | TestInfo) => {
        if (subnode.type === 'suite') {
            parseSuiteTestResults(subnode, stdout, testStatesEmitter);
        } else {
            const regex: RegExp = new RegExp(
                '^\\d+\\)\\s[A-Za-z0-9\\\\_]+::' + subnode.label + '$',
                'gm'
            );
            const hasError = stdout.match(regex) !== null;
            testStatesEmitter.fire(<TestEvent>{
                test: subnode.id,
                type: 'test',
                state: hasError ? 'failed' : 'passed',
                message: stdout,
            });
        }
    });
}

async function runPHPUnitSingleTest(
    node: TestInfo,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >
): Promise<void> {
    return new Promise((resolve) => {
        testStatesEmitter.fire(<TestEvent>{
            type: 'test',
            test: node.id,
            state: 'running',
        });

        const command =
            vscode.workspace
                .getConfiguration('woo-test-explorer')
                .get('command') +
            ' -- --filter "/' +
            node.id +
            '(\\s.*)?$/"';

        spawnShellWithOutput(
            command,
            (code: number, signal: NodeJS.Signals | null, stdout: string) => {
                testStatesEmitter.fire(<TestEvent>{
                    type: 'test',
                    test: node.id,
                    state: code !== 0 ? 'failed' : 'passed',
                });
                resolve();
            }
        );
    });
}

function spawnShellWithOutput(
    command: string,
    callback: CallableFunction
): void {
    if (outputChannel) outputChannel.dispose();
    outputChannel = vscode.window.createOutputChannel('Woo Test Explorer');
    outputChannel.show(true);

    const runner = cp.spawn(command, ['--colors=never'], {
        cwd: vscode.workspace.rootPath,
        env: process.env,
        shell: true,
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
		outputChannel?.appendLine("Command exited with code: " + code);
        callback(code, signal, stdout);
    });
}
