'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// The module 'azdata' contains the Azure Data Studio extensibility API
// This is a complementary set of APIs that add SQL / Data-specific functionality to the app
// Import the module and reference it with the alias azdata in your code below

import * as azdata from 'azdata';
import { firstValueFrom, ReplaySubject, take } from 'rxjs';

interface ColumnsData {
    [key: string]: any
    columnName: string
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

   const fromSubj$ = new ReplaySubject<string>(1);
    //make the visualizer icon visible
   vscode.commands.executeCommand('setContext', 'showVisualizer', true);

    // Ideally would unregister listener on deactivate, but this is currently a void function.
    // Issue #6374 created in ADS repository to track this ask
    azdata.queryeditor.registerQueryEventListener({
        async onQueryEvent(type: string, document: azdata.queryeditor.QueryDocument, args: any) {
            if (type === 'visualize') {
                const providerid = document.providerId;
                const provider: azdata.QueryProvider = azdata.dataprotocol.getProvider(providerid, azdata.DataProviderType.QueryProvider);
                const data = await provider.getQueryRows({
                    ownerUri: document.uri,
                    batchIndex: args.batchId,
                    resultSetIndex: args.id,
                    rowsStartIndex: 0,
                    rowsCount: args.rowCount,
                });

                const rows = data.resultSubset.rows;
                const columns: ColumnsData[] = args.columnInfo;
                const rowsCount = args.rowCount;

                // Create Json
                let jsonArray = createJsonArrayFromRecordSet(rows, rowsCount, columns)
                let possibleFrom = await firstValueFrom<string>(fromSubj$)

                azdata.queryeditor.openQueryDocument({content: buildInsertInto(possibleFrom ?? 'UNKNOUN', columns.filter(y => y.columnName != 'RowGuid'), jsonArray)})
            }
            if (type === 'queryStart') {
               let queryEditorText = vscode.window.activeTextEditor?.document.getText()
               if (queryEditorText && queryEditorText.toUpperCase().includes('FROM')){
                   const firstOccurenceIndex = queryEditorText.toUpperCase().indexOf('FROM')
                   const possibleFrom = queryEditorText.substring(firstOccurenceIndex).split(' ')[1]
                   fromSubj$.next(possibleFrom)
               }
            }
        },
    });
}

// this method is called when your extension is deactivated
export function deactivate() {
}

//# region private methods
interface jsonType {
    [key: string]: any
}

export function createJsonArrayFromRecordSet(rows: azdata.DbCellValue[][], rowsCount: number, columns: ColumnsData[]): jsonType[]{
    const jsonArray: jsonType[] = [];

    for (let row = 0; row < rowsCount; row++) {
        const jsonObject: jsonType = {};
        for (let col = 0; col < columns.length; col++) {
            if (!rows[row][col].isNull) {
                jsonObject[columns[col].columnName] = rows[row][col].displayValue;
            }
            // If display value is null, don't do anything for now
        }
        jsonArray.push(jsonObject);
    }
    return jsonArray;
}

export function buildInsertInto(TableName:string, columns: ColumnsData[], jsonArray:jsonType[]): string{
    let insertIntoQueryArray : string[] = [];
    jsonArray.forEach(row => {
        let vals: string[] = [];
        vals = columns.reduce((prev, curr) => {
            if (Object.prototype.hasOwnProperty.call(row, curr.columnName)) {
                prev.push(row[curr.columnName])
            }
            else
                prev.push('null')
            return prev
        }, vals);
        let insertIntoQuery: string = "INSERT INTO " + TableName + " (" + columns.map(x => x.columnName).join(", ") + ") VALUES (" + vals.map(x => (x === 'null' || x == null) ? 'NULL' : `'${x}'`).join(", ") + ");";
        insertIntoQueryArray.push(insertIntoQuery);
    })
    return insertIntoQueryArray.join("\n");
}

//# endregion