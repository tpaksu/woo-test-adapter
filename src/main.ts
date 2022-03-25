import * as vscode from 'vscode';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { WooTestAdapter } from './adapter';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

    // create a simple logger that can be configured with the configuration variables
    const log = new Log(
        'woo-test-explorer',
        workspaceFolder,
        'Woo Test Explorer Log'
    );
    context.subscriptions.push(log);

    // get the Test Explorer extension
    const testExplorerExtension = vscode.extensions.getExtension<TestHub>(
        testExplorerExtensionId
    );
    if (log.enabled)
        log.info(
            `Woo Test Explorer ${testExplorerExtension ? '' : 'not '}found`
        );

    if (testExplorerExtension) {
        const testHub = testExplorerExtension.exports;
		const adapter: WooTestAdapter = new WooTestAdapter(workspaceFolder, log)
        // this will register an ExampleTestAdapter for each WorkspaceFolder
        context.subscriptions.push(
            new TestAdapterRegistrar(
                testHub,
                (workspaceFolder) => adapter,
                log
            )
        );

        vscode.workspace.onDidChangeConfiguration(
            (e: vscode.ConfigurationChangeEvent) => {
                if (e.affectsConfiguration('woo-test-explorer')) {
                    adapter.reload()
                }
            }
        );
    }
}
