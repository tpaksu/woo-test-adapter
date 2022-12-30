import * as vscode from 'vscode';
import * as fs from 'fs';

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
        const readFileAsync = function (filename: string) {
            return new Promise(
                (
                    resolve: (value: Buffer | PromiseLike<Buffer>) => void,
                    reject
                ) => {
                    fs.readFile(
                        filename,
                        (err: NodeJS.ErrnoException | null, buffer: Buffer) => {
                            if (err) reject(err);
                            else resolve(buffer);
                        }
                    );
                }
            );
        };

        readFileAsync(fileUri.path)
            .then((value) => {
                lineText =
                    value
                        .toString()
                        .replace(/\r\n/g, '\n')
                        .split('\n', line + 1)
                        .pop() || '';
            })
            .then(() => {
                const position = new vscode.Range(
                    line,
                    lineText.length - lineText.trimStart().length,
                    line,
                    lineText.trimEnd().length
                );
                const diagnostic = new vscode.Diagnostic(
                    position,
                    error,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'woo-test-explorer';
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
