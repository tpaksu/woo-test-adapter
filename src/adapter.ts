import * as vscode from 'vscode';
import {
    TestAdapter,
    TestLoadStartedEvent,
    TestLoadFinishedEvent,
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { WooDiagnostics } from './diagnostics';
import { loadTests, runTests } from './wooTestRunner';

/**
 * This class is intended as a starting point for implementing a "real" TestAdapter.
 * The file `README.md` contains further instructions.
 */
export class WooTestAdapter implements TestAdapter {
    private disposables: { dispose(): void }[] = [];

    private readonly testsEmitter = new vscode.EventEmitter<
        TestLoadStartedEvent | TestLoadFinishedEvent
    >();
    private readonly testStatesEmitter = new vscode.EventEmitter<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >();
    private readonly autorunEmitter = new vscode.EventEmitter<void>();

    private testRunId = 0;

    private cancellationToken = new vscode.CancellationTokenSource();

    get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
        return this.testsEmitter.event;
    }
    get testStates(): vscode.Event<
        TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    > {
        return this.testStatesEmitter.event;
    }
    get autorun(): vscode.Event<void> | undefined {
        return this.autorunEmitter.event;
    }

    constructor(
        public readonly workspace: vscode.WorkspaceFolder,
        private readonly log: Log,
        private readonly diags: WooDiagnostics
    ) {
        this.log.info('Initializing Woo Test Explorer');

        this.disposables.push(this.testsEmitter);
        this.disposables.push(this.testStatesEmitter);
        this.disposables.push(this.autorunEmitter);
        this.disposables.push(this.diags);
    }

    async load(): Promise<void> {
        this.log.info('Loading tests..');

        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
        this.diags.clear();
        
        const loadedTests = await loadTests(this.log);

        this.testsEmitter.fire(<TestLoadFinishedEvent>{
            type: 'finished',
            suite: loadedTests,
        });

        const uris = loadedTests.children.map((suite) => {
            return suite.uri;
        });

        vscode.workspace.onDidSaveTextDocument(async (e: vscode.TextDocument) => {
            if (uris.find((uri) => uri === e.uri.path)) {
                await this.reload();
                return;
            }
        });
    }

    async reload(): Promise<void> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Reloading tests..',
                cancellable: false,
            },
            async (progress, token) => {
                this.testsEmitter.fire(<TestLoadStartedEvent>{
                    type: 'started',
                });
                this.diags.clear();
                const loadedTests = await loadTests(this.log);
                this.log.info('Loaded tests..');
                this.testsEmitter.fire(<TestLoadFinishedEvent>{
                    type: 'finished',
                    suite: loadedTests,
                });
            }
        );
    }

    async run(tests: string[]): Promise<void> {
        this.log.info(`Running tests ${JSON.stringify(tests)}`);
        this.diags.clear();
        this.testRunId++;
        this.testStatesEmitter.fire(<TestRunStartedEvent>{
            type: 'started',
            tests,
            testRunId: 'wooTestRun' + this.testRunId.toString(),
        });
        
        this.cancellationToken = new vscode.CancellationTokenSource();

        // in a "real" TestAdapter this would start a test run in a child process
        runTests(
            tests,
            this.testStatesEmitter,
            this.diags,
            this.cancellationToken.token
        )
            .catch(() => {})
            .finally(() => {
                this.testStatesEmitter.fire(<TestRunFinishedEvent>{
                    type: 'finished',
                    testRunId: 'wooTestRun' + this.testRunId.toString(),
                });
            });
    }

    cancel(): void {
        this.cancellationToken.cancel();
        this.testStatesEmitter.fire(<TestRunFinishedEvent>{
            type: 'finished',
            testRunId: 'wooTestRun' + this.testRunId.toString(),
        });
    }

    dispose(): void {
        this.cancel();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
