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
import { WooSuite } from './wooSuite';
import { WooTest, WooTestState } from './wooTest';

let fileChangeListener: vscode.Disposable;

const testSuite: WooSuite = new WooSuite('root', 'Woo Test Explorer');

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

    log.debug(searchPaths, excludePaths);

    return new Promise<WooSuite>((resolve) => {
        testSuite.children = [];
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
                if (fileChangeListener) fileChangeListener.dispose();
                fileChangeListener = vscode.workspace.onDidSaveTextDocument(
                    (e: vscode.TextDocument) => {
                        if (
                            uris.filter((uri: vscode.Uri) => {
                                return uri.path === e.uri.path;
                            }).length > 0
                        ) {
                            vscode.window.withProgress(
                                {
                                    location:
                                        vscode.ProgressLocation.Notification,
                                    title: 'Reloading tests..',
                                    cancellable: false,
                                },
                                async (progress, token) => {
                                    await loadTests(log);
                                }
                            );
                        }
                    }
                );
                return resolve(testSuite);
            });
    });
}

export async function runTests(
    tests: string[],
    testStatesEmitter: vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
    diags: WooDiagnostics
): Promise<void> {
    for (const suiteOrTestId of tests) {
        const node = findNode(testSuite, suiteOrTestId);
        if (node) await runNode(node, testStatesEmitter, diags);
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
            const newSuite = new WooSuite(
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
                    `${parentKey}::${matchFound}`,
                    matchFound,
                    '',
                    WooTestState.WOO_SUITE_PENDING,
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
    diags: WooDiagnostics
): Promise<void> {
    try {
        if (node instanceof WooSuite) {
            return runPHPUnitTestSuite(node, testStatesEmitter, diags);
        } else {
            return runPHPUnitSingleTest(node, testStatesEmitter, diags);
        }
    } catch (e) {
        console.log(e);
    }
}
