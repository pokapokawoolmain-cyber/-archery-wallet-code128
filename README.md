# Archery Wallet Starter (Code128版)

全日本アーチェリー連盟の紙会員証をもとに、**個人用の Apple Wallet 表示カード**を URL 経由で生成するための最小構成です。

## この版で固定した仕様

- 表示項目: `氏名 / 会員番号 / 所属`
- 会員番号ルール: `00 + 5桁数字` の **7桁固定**
- バーコード形式: **Code 128**
- バーコード文字列: `A010100 + 会員番号 + A`
- 例: 会員番号 `0011464` → バーコード `A0101000011464A`

## できること

- 入力フォームで `氏名 / 会員番号 / 所属` を受け取る
- Node.js + Express で `.pkpass` を生成する
- iPhone の Safari から Apple Wallet に追加する
- Railway にそのまま載せやすい構成になっている

## ディレクトリ構成

```text
archery-wallet-starter/
├─ certs/
│  ├─ wwdr.pem
│  ├─ signerCert.pem
│  └─ signerKey.pem
├─ public/
│  └─ index.html
├─ wallet-model/
│  └─ member.pass/
│     ├─ pass.json
│     ├─ icon.png
│     ├─ icon@2x.png
│     ├─ logo.png
│     └─ logo@2x.png
├─ .env.example
├─ package.json
├─ railway.json
├─ README.md
└─ server.js
```

## 1. Apple 側で準備するもの

- Apple Developer Program 加入済みアカウント
- Pass Type Identifier
- Pass Type ID certificate
- WWDR intermediate certificate

このプロジェクトでは `certs/` に次の名前で配置してください。

- `wwdr.pem`
- `signerCert.pem`
- `signerKey.pem`

## 2. ローカル起動

```bash
cp .env.example .env
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

## 3. .env の設定

```env
PORT=3000
PASS_TYPE_IDENTIFIER=pass.com.yourname.archerymember
TEAM_IDENTIFIER=YOURTEAMID
ORGANIZATION_NAME=Your Organization
PASS_DESCRIPTION=Archery Member Display Card
SIGNER_KEY_PASSPHRASE=
```

## 4. 入力ルール

会員番号は次の形式のみ受け付けます。

```text
00 + 5桁数字
```

例:

```text
0011464
```

この入力値から、サーバー側で次のバーコード文字列を自動生成します。

```text
A0101000011464A
```

## 5. 使い方

1. iPhone の Safari で公開 URL を開く
2. 氏名・会員番号・所属を入力する
3. 「Apple Wallet に追加」を押す
4. `.pkpass` が返る
5. Wallet に追加する

## 6. Railway デプロイ

最短手順:

1. GitHub にこのフォルダを push
2. Railway で `New Project`
3. GitHub リポジトリを選択
4. Variables に `.env` の値を登録
5. `certs/` を安全な方法で配置する

## 7. v1 の立ち位置

この構成は **公式会員証の代替ではなく、個人用の補助表示カード** として設計しています。

## 8. 実機確認

この版は **Code 128** を使い、内容文字列は既存カード互換の `A010100 + 会員番号 + A` にしています。公開前に、実際の iPhone とバーコードリーダーで読み取り確認をしてください。
