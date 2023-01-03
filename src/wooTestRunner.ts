import * as vscode from 'vscode';
import * as fs from 'fs';

import {
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { runPHPUnitSingleTest, runPHPUnitTestSuite } from './phpUnit';
import { WooDiagnostics } from './diagnostics';
import { WooSuite, WooSuiteState } from './wooSuite';
import { WooTest, WooTestState } from './wooTest';

let testSuite: WooSuite = new WooSuite('', 'root', 'Woo Test Explorer');

export function loadTests(log: Log): Promise<WooSuite> {
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
    
    testSuite = new WooSuite('', 'root', 'Woo Test Explorer');

    return new Promise<WooSuite>((resolve) => {
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
                resolve(testSuite);
            });
    });
}

export async function runTests(
    tests: string[],
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    let continueRunning = true;
    for (const suiteOrTestId of tests) {
        if (!continueRunning) break;
        const node = findNode(testSuite, suiteOrTestId);
        if (node)
            await runNode(
                node,
                testStatesEmitter,
                diags,
                cancellationToken
            ).catch(() => {
                continueRunning = false;
            });
    }
    updateStates(testSuite, testStatesEmitter);
}

function getTestSuite(path: string, log: Log): void {
    var data = fs.readFileSync(path);
    if (data) {
        const match: RegExpMatchArray | null = data
            .toString()
            .match(/^class (\w+)\s*(\s*extends \w+)*\s*\{/im);
        if (match) {
            const testName: string = match[1];
            const newSuite = new WooSuite(
                path,
                testName,
                testName,
                undefined,
                undefined,
                path
            );
            testSuite.addChildren(newSuite);
            const suiteTests: WooTest[] = getTestMethods(testName, path, log);
            suiteTests.forEach((suiteTest) => newSuite.addChildren(suiteTest));
        }
    }
}

function getTestMethods(parentKey: string, path: string, log: Log): WooTest[] {
    const testsInFile: WooTest[] = [];
    var data = fs.readFileSync(path);
    if (data) {
        for (const match of data
            .toString()
            .matchAll(/public function (test_\w+)\(/gm)) {
            const matchFound: string = match[1];
            const matchOffset: number = match['index'] || 1;
            const matchLine: number =
                match['input']?.slice(0, matchOffset).split('\n').length || 1;
            testsInFile.push(
                new WooTest(
                    path,
                    `${parentKey}::${matchFound}`,
                    matchFound,
                    '',
                    WooTestState.WOO_TEST_PENDING,
                    path,
                    matchLine - 1
                )
            );
        }
    }
    return testsInFile;
}

function findNode(
    searchNode: WooSuite | WooTest,
    id: string
): WooSuite | WooTest | undefined {
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
    node: WooSuite | WooTest,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    try {
        if (cancellationToken.isCancellationRequested) {
            return Promise.reject();
        }
        if (node instanceof WooSuite) {
            return runPHPUnitTestSuite(
                node,
                testStatesEmitter,
                diags,
                cancellationToken
            );
        } else {
            return runPHPUnitSingleTest(
                node,
                testStatesEmitter,
                diags,
                cancellationToken
            );
        }
    } catch (e) {
        console.log(e);
        return Promise.reject();
    }
}

function updateStates(
    node: WooSuite,
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >
): string {
    let state: string = WooTestState.WOO_TEST_PENDING;
    for (let i = 0; i < node.children.length; i++) {
        const child: WooSuite | WooTest = node.children[i];
        if (child instanceof WooSuite) {
            const suiteState = updateStates(child, testStatesEmitter);
            child.setState(testStatesEmitter, <WooSuiteState>suiteState);
        } else if (child instanceof WooTest) {
            state =
                state === WooTestState.WOO_TEST_FAILED
                    ? WooTestState.WOO_TEST_FAILED
                    : child.state;
        }
    }
    switch (state) {
        case WooTestState.WOO_TEST_FAILED:
            return WooSuiteState.WOO_SUITE_ERRORED;
        case WooTestState.WOO_TEST_PASSED:
            return WooSuiteState.WOO_SUITE_COMPLETED;
        case WooTestState.WOO_TEST_RUNNING:
            return WooSuiteState.WOO_SUITE_RUNNING;
        default:
            return WooSuiteState.WOO_SUITE_PENDING;
    }
}
