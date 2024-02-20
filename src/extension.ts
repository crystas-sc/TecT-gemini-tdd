import * as vscode from 'vscode';
import { genUnitTests, genUnitTestsFileName, validateTestCodeAgainstAcceptCrit } from './geminigen';
import * as fs from 'fs';
// import cp from 'child_process';


export function activate(context: vscode.ExtensionContext) {

	const provider = new ColorsViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ColorsViewProvider.viewType, provider));

	provider.deriveTestFrameworkFromWorkSpaceFiles();

	// context.subscriptions.push(
	// 	vscode.commands.registerCommand('calicoColors.addColor', () => {
	// 		provider.addColor();
	// 	}));

	// context.subscriptions.push(
	// 	vscode.commands.registerCommand('calicoColors.clearColors', () => {
	// 		provider.clearColors();
	// 	}));


}

class ColorsViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'calicoColors.colorsView';

	private _view?: vscode.WebviewView;
	public workspaceTestingFramework: string = "";

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {

				case 'genTests':
					{
						vscode.window.showInformationMessage(JSON.stringify(data.value));
						const { apiToken, projTestingFramework, acceptanceCriteria } = data.value
						const code = await genUnitTests(acceptanceCriteria, projTestingFramework, apiToken);
						vscode.window.showInformationMessage(code);
						let fileName = await genUnitTestsFileName(acceptanceCriteria, projTestingFramework, apiToken);
						fileName = fileName || "test" + Math.floor(Math.random() * 1000)
						fileName = fileName + this.getFileExtension(projTestingFramework);
						webviewView.webview.postMessage({ type: 'genTestsComplete', code });
						this.createTestFile(fileName, code);
						break;
					}
				case "validateUTestAgainstAcceptCrit":
					{
						const { apiToken, projTestingFramework, acceptanceCriteria } = data.value

						const cp = require("child_process")
						function execAsync(command: string) {
							return new Promise((resolve: any, reject: any) => {
								cp.exec(command, { cwd: vscode.workspace.rootPath }, (err: string, stdout: string, stderr: string) => {
									if (err) {
										reject(err)
									} else {
										resolve({ stdout, stderr })
									}
								})
							})
						}

						let stagedCode = "";
						const grepCmdForFiltExt = " | grep test | grep java"
						const cmd = "git diff --cached --name-only  | grep test | grep java"
						const result: any = await execAsync(cmd)
						const files: string[] = result?.stdout?.split("\n")
						console.log("files", files)
						const promises = files.filter((f: string) => !!f)
							.map(async (file: string) => {
								let cmd = `git diff --cached ${file} | grep -e "^+ "`
								const result: any = await execAsync(cmd)
								return result.stdout.replace(/\+ /gi,"")
							})
						const results = await Promise.all(promises)

						const code = results.reduce((a: string, c: string) => { return a + c + "\n\n" }, "");
						const geminiOp = await validateTestCodeAgainstAcceptCrit(acceptanceCriteria, projTestingFramework, code, apiToken)
						console.log("geminiOp", geminiOp)
						vscode.workspace.openTextDocument({ content: geminiOp, language: "markdown" })
							.then(document => {
								vscode.window.showTextDocument(document)
							})
						// cp.exec(cmd, { cwd: vscode.workspace.rootPath }, async (err: string, stdout: string, stderr: string) => {
						// 	if (err) {
						// 		vscode.window.showErrorMessage(err?.message);
						// 	}
						// 	const files = stdout.split("\n")
						// 	console.log("files", files)
						// 	files.filter(f => !!f).map(file => {
						// 		let cmd =`git diff --cached ${file} | grep -e "^+ "`
						// 		cp.exec(cmd,
						// 			{ cwd: vscode.workspace.rootPath },
						// 			async (err: string, stdout: string, stderr: string) => {
						// 				if (err) {
						// 					vscode.window.showErrorMessage(err);
						// 				}
						// 				stagedCode += stdout + "\n\n"
						// 				console.log("stagedCode",stagedCode)
						// 			})
						// 	})
						// 	await validateTestCodeAgainstAcceptCrit()


						// })
						console.log("stagedCode", stagedCode)
					}
			}
		});
	}

	public getFileExtension(testingFramework: string) {
		switch (testingFramework) {
			case "pytest Python library":
				return ".py";
			case "jest Javascript library":
				return ".js";
			case "Junit Java library":
				return ".java";
			default:
				return ".txt";
		}
	}

	public async deriveTestFrameworkFromWorkSpaceFiles() {
		const files = await this.listFilesInRoot()
		let testingFramework = "pytest Python library";
		if (files.includes("package.json"))
			testingFramework = "jest Javascript library";
		else if (files.includes("pom.xml") || files.includes("build.gradle"))
			testingFramework = "Junit Java library";


		this.workspaceTestingFramework = testingFramework;
		vscode.window.showInformationMessage('Testing Framework in workspace: ' + this.workspaceTestingFramework);
		this?._view?.webview?.postMessage({ type: 'workspaceTestingFramework', testingFramework });
	}

	public async listFilesInRoot() {
		// Get the current workspace folders
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (workspaceFolders && workspaceFolders.length > 0) {
			// Get the root folder of the first workspace folder
			const rootFolder = workspaceFolders[0].uri;

			// Use the `vscode.workspace.fs.readDirectory` API to get the list of files and folders in the root folder
			const entries = await vscode.workspace.fs.readDirectory(rootFolder);

			return entries.filter(([name, type]) => {
				// console.log(name, type);
				return type === vscode.FileType.File

			}).map(([name, _]) => name);

		} else {
			vscode.window.showInformationMessage('No workspace opened');
		}
		return [];
	}

	public async createTestFile(fileName: string, content: string) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}
		const workspaceFolder = workspaceFolders[0]; // Assuming single workspace folder

		// Create the full path for the new file
		const filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName);

		// Check if the file already exists
		if (fs.existsSync(filePath.fsPath)) {
			vscode.window.showErrorMessage('File already exists');
			return;
		}

		// Create the new file
		fs.writeFileSync(filePath.fsPath, content);

		// Open the newly created file
		vscode.workspace.openTextDocument(filePath).then((document) => {
			vscode.window.showTextDocument(document);
		});
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>тест Intern</title>
			</head>
			<body>
			<form id="form" action="javascript:void()" id="genForm" >
				<fieldset>
				<label>Gemini API token</label>
				<input type="password" name="apiToken" />
				</fieldset>

				<fieldset>
				<label>Project's Testing Framework</label>
				<input id="proj-testing-framework" type="text" name="projTestingFramework" />
				</fieldset>

				<fieldset>
				<label>Acceptance criteria</label>
				<textarea name="acceptanceCriteria" rows="10"></textarea>
				</fieldset>

				<button type="submit" id="submitButton" >Generate Tests</button>

			</form>
				<button type="button" id="validate">Validate</button>

				<div style="font-size:0.5em">Validate staged Unit test code against Accceptance criteria </div>
				<div id="status"></div>

				<pre id="code"></pre>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
