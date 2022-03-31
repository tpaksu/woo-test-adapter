import * as vscode from 'vscode';
import {
    TestInfo,
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from 'vscode-test-adapter-api';

export class WooTest implements TestInfo {
    public id: string;
    public label: string;
    public message: string;
    public state: WooTestState;
    public type: 'test';
    public file?: string;
    public line?: number;
    constructor(
        id: string,
        label: string,
        message: string,
        state: WooTestState,
        file?: string,
        line?: number
    ) {
        this.id = id;
        this.label = label;
        this.message = message;
        this.state = state;
        this.file = file;
        this.line = line;
        this.type = 'test';
    }

    public setState(
        testStatesEmitter: vscode.EventEmitter<
            | TestRunStartedEvent
            | TestRunFinishedEvent
            | TestSuiteEvent
            | TestEvent
        >,
        state: WooTestState
    ) {
        this.state = state;
        this.update(testStatesEmitter);
    }

    private update(
        testStatesEmitter: vscode.EventEmitter<
            | TestRunStartedEvent
            | TestRunFinishedEvent
            | TestSuiteEvent
            | TestEvent
        >
    ) {
        testStatesEmitter.fire(<TestEvent>{
            test: this.id,
            type: this.type,
            state: this.state,
            message: this.message,
        });
    }
}

export enum WooTestState {
    WOO_TEST_RUNNING = 'running',
    WOO_TEST_FAILED = 'failed',
    WOO_TEST_PASSED = 'passed',
    WOO_TEST_PENDING = '',
}
