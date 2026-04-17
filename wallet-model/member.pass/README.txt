この member.pass は差し替え用のテンプレートです。

入っているもの:
- logo.png (160x50)
- logo@2x.png (320x100)
- icon.png (29x29)
- icon@2x.png (58x58)
- pass.json

使い方:
1. 既存の wallet-model/member.pass/ にある同名画像をこの4枚で置き換える
2. pass.json も必要なら置き換える
3. server.js で pass.barcode = barcode が入っていることを確認
4. node server.js / railway up で再生成
