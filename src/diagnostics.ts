import * as vscode from 'vscode';

export class WooDiagnostics {
    private diagnosticCollection: vscode.DiagnosticCollection;
    constructor(context: vscode.ExtensionContext) {
        this.diagnosticCollection =
            vscode.languages.createDiagnosticCollection('php');
        context.subscriptions.push(this.diagnosticCollection);
    }

    public addError(file: string, line: number, error: string): void {
        const fileUri = vscode.Uri.file(file);
        let lineText: string = '';
        vscode.workspace.fs
            .readFile(fileUri)
            .then((value: Uint8Array) => {
                lineText =
                    value
                        .toString()
                        .replace(/\r\n/g, '\n')
                        .split('\n', line + 1)
                        .pop() || '';
            })
            .then(() => {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(
                        line,
                        lineText.length - lineText.trimStart().length,
                        line,
                        lineText.trimEnd().length
                    ),
                    error
                );
                let previousDiagnostics: readonly vscode.Diagnostic[] =
                    this.diagnosticCollection.get(fileUri) || [];
                this.diagnosticCollection.set(
                    fileUri,
                    previousDiagnostics.concat([diagnostic])
                );
            });
    }
    public clear() {
        this.diagnosticCollection.clear();
    }
    dispose(): void {
        this.diagnosticCollection.clear();
        this.diagnosticCollection.dispose();
    }
}
