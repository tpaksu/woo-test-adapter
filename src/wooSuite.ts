import * as vscode from 'vscode';
import {
    TestSuiteInfo,
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestEvent,
} from 'vscode-test-adapter-api';
import { WooTest } from './wooTest';

export class WooSuite implements TestSuiteInfo {
    public id: string;
    public label: string;
    public message: string;
    protected state: WooSuiteState;
    public children: (WooSuite | WooTest)[];
    public type: 'suite';
    public file?: string;
    public line?: number;
    constructor(
        id: string,
        label: string,
        message?: string,
        state?: WooSuiteState,
        file?: string,
        line?: number
    ) {
        this.id = id;
        this.label = label;
        this.message = message || '';
        this.state = state || WooSuiteState.WOO_SUITE_PENDING;
        this.file = file;
        this.line = line;
        this.children = [];
        this.type = 'suite';
    }

    public addChildren(node: WooSuite | WooTest) {
        this.children.push(node);
    }

    public setState(
        testStatesEmitter: vscode.EventEmitter<
            | TestRunStartedEvent
            | TestRunFinishedEvent
            | TestSuiteEvent
            | TestEvent
        >,
        state: WooSuiteState
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
        testStatesEmitter.fire(<TestSuiteEvent>{
            suite: this.id,
            type: this.type,
            state: this.state,
            message: this.message,
        });
    }
}

export enum WooSuiteState {
    WOO_SUITE_PENDING = '',
    WOO_SUITE_RUNNING = 'running',
    WOO_SUITE_ERRORED = 'errored',
    WOO_SUITE_COMPLETED = 'completed',
}
