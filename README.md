# TodoApp1
Created with CodeSandbox

## 起動

`npm install`で依存関係をインストールし、`npm start`で開発サーバーを起動します。

## テスト

Node.js 18以上で`npm test`を実行します。テストはNode.js標準のテストランナーを使い、依存関係のインストールなしで実行できます。

## データ保存

TodoはブラウザのlocalStorageに保存されます。同じURLの配信元で再度開くと復元されます。別のブラウザや配信元とは共有されません。保存が利用できない場合は画面に通知します。
