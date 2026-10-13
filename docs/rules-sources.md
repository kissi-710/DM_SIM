# ルールの出典一覧(DM_SIM のルール根拠にするサイト)

- 作成日: 2026-10-14
- 目的: コードと docs のルールが公式とズレないよう、**根拠にしてよいサイトと、その使い分け**を1か所にまとめる。
- 関連: [rules-reference.md](./rules-reference.md)(取得したルールの要約と、コードとの照合)/ [spec.md](./spec.md) 第3章 / [effects.md](./effects.md) 15.2(要確認ルール台帳)

## 1. 出典と優先順位

ルールの食い違いは、**上の出典が下の出典に勝つ**。

| 順位 | 区分 | 名称 | URL | 使い方 |
|---|---|---|---|---|
| 1 | 一次(公式) | **デュエル・マスターズ総合ゲームルール Ver.1.52**(最終更新 2026-09-18、93ページ) | <https://dm.takaratomy.co.jp/img/dm_rule_20260918.pdf> | 条番号つきの根拠。**原文**。実装の最終的な基準 |
| 2 | 一次(公式) | 総合ルール・変更点・最新の裁定(ルール更新の入口) | <https://dm.takaratomy.co.jp/rule/rulechange/> | PDF の最新版の確認、各回の「変更点」、FAQ 回答変更のお知らせ |
| 3 | 一次(公式) | よくある質問(Q&A) | <https://dm.takaratomy.co.jp/rule/qa/>(個別: `/rule/qa/{番号}/`、旧版: `/rule/qa_old/{番号}/`) | **カードの個別能力・キーワード能力の裁定**。総合ルールに個別定義がない能力は、ここが根拠になる |
| 4 | 一次(公式) | カード詳細ページ | `https://dm.takaratomy.co.jp/card/detail/?id={カードID}` | カードの**現行テキスト**。「このカードのよくある質問」へのリンクがある(例: ジ・ウォッチ → `/rule/qa/45931/`) |
| 5 | 一次(公式) | 競技イベント運営ルール(2025-05-01) | <https://dm.takaratomy.co.jp/img/dm_competition_rule_20250501.pdf> | 大会運営(時間切れ・反則など)。**ゲーム進行のルールではない**ので、エンジンの根拠には使わない |
| 6 | 二次(ファン運営) | デュエル・マスターズ Wiki(DMwiki) | <https://dmwiki.net/>(総合ルール本文: <https://dmwiki.net/総合ルール本文>、公式ルール: <https://dmwiki.net/公式ルール>) | 公式 Q&A の**索引**・用語の解説。**必ず公式の原文に戻って確認する**。公式と食い違う記述がありうる |
| 参考 | 既存ツール | Duel Masters Hub(一人回し) | [reference_duel-hub.md](./reference_duel-hub.md) | UI・効果記述の参考のみ。ルールの根拠にしない |

### 総合ルールの版(過去版。条番号の対応を調べる時に使う)

| 版 | 最終更新 | URL |
|---|---|---|
| Ver.1.52 | 2026-09-18 | <https://dm.takaratomy.co.jp/img/dm_rule_20260918.pdf> |
| Ver.1.50 | 2026-04-10 | <https://dm.takaratomy.co.jp/img/dm_rule_20260410_4.pdf> |
| Ver.1.47 | 2025-10-17 | <https://dm.takaratomy.co.jp/img/dm_rule_20251017.pdf> |
| Ver.1.42 | 2024-06-19 | <https://dm.takaratomy.co.jp/img/dm_rule_20240619.pdf> |

### 変更点ページ(総合ルールの更新ごと)

| 掲載日 | URL |
|---|---|
| 2026-09-18 | <https://dm.takaratomy.co.jp/rule/rulechange/316687/> |
| 2026-07-23 | <https://dm.takaratomy.co.jp/rule/rulechange/%e5%a4%89%e6%9b%b4%e7%82%b92026-07-23/> |
| 2026-04-10 | <https://dm.takaratomy.co.jp/rule/rulechange/316683/> |
| 2026-02-13 | <https://dm.takaratomy.co.jp/rule/rulechange/316680/> |
| 2025-12-17 | <https://dm.takaratomy.co.jp/rule/rulechange/316678/> |
| 2025-10-17 | <https://dm.takaratomy.co.jp/rule/rulechange/316677/> |
| 2025-10-01 | <https://dm.takaratomy.co.jp/rule/rulechange/316675/> |
| 2025-05-01 | <https://dm.takaratomy.co.jp/rule/rulechange/316673/> |

### FAQ 回答変更・個別のルール変更のお知らせ

| 掲載日 | 内容 | URL |
|---|---|---|
| 2026-07-09 | 一部 FAQ の回答変更(ゾーンに置かれた時にトリガーする能力、G・リンク、効果の無視) | <https://dm.takaratomy.co.jp/rule/rulechange/316685/> |
| 2026-06-11 | 一部 FAQ の回答変更(**未精査**) | <https://dm.takaratomy.co.jp/rule/rulechange/316684/> |
| 2026-04-10 | 一部 FAQ の回答変更(**未精査**) | <https://dm.takaratomy.co.jp/rule/rulechange/316682/> |
| 2025-10-08 | 一部 FAQ の回答変更(**未精査**) | <https://dm.takaratomy.co.jp/rule/rulechange/316676/> |
| 2025-05-01 | 一部 FAQ の回答変更(**未精査**) | <https://dm.takaratomy.co.jp/rule/rulechange/316674/> |
| 2025-04-08 | カードテキストのテンプレート変更と新用語「実行」 | <https://dm.takaratomy.co.jp/rule/rulechange/316670/> |
| 2024-12-20 | 《禁断 ～封印されしX～》《FORBIDDEN STAR》のルール変更 | <https://dm.takaratomy.co.jp/rule/rulechange/316667/> |
| 2023-10-18 | ジャストダイバー関連のルール変更(総合ルール 300.3) | <https://dm.takaratomy.co.jp/rule/rulechange/316651/> |

## 2. 使い方の決まり

1. **実装の根拠は、1(総合ルール原文)→ 3・4(公式 Q&A・カードテキスト)の順に探す。**DMwiki だけが根拠の項目は、台帳に「二次」と書き、公式で確認できるまで仮の扱いとする。
2. **総合ルールにはキーワード能力の個別定義がない**(スピードアタッカー・マッハファイター・ジャストダイバー・ハイパーエナジー・ヨビニオンなどは、PDF 全文に定義が無いことを確認済み)。これらは公式 Q&A・変更点・カードの注釈文が根拠になる。
3. **条番号は版で変わる**。docs に条番号を書く時は版も書く(基準は Ver.1.52)。ルールが更新されたら、変更点ページ(上の表)で差分を見る。
4. **公式ページの取得ツールは、要約を返すことがある**。本書と rules-reference.md の【Q&A】は要約経由なので、**実装・テストに固定する前に、リンク先の原文を目で確認する**。総合ルール(PDF)だけは、全文を `pdftotext` で取り出して直接読んだ。
5. **権利**: PDF・FAQ・カードの文章は権利者のもの。docs には**要約と条番号、URL**だけを書き、全文は転載しない。PDF 自体もリポジトリにコミットしない。

## 3. 総合ルール PDF の取り出し方(再現手順)

PDF はテキストを埋め込んだ形式で、`pdftotext` で全文が取り出せる(`-layout` で条番号の行が崩れにくい)。作業用のフォルダはリポジトリの外に作る。

```bash
mkdir -p /tmp/dm-rule && cd /tmp/dm-rule
curl -L -o rule.pdf https://dm.takaratomy.co.jp/img/dm_rule_20260918.pdf
pdftotext -layout -enc UTF-8 rule.pdf rule.txt
grep -n "^ *801\." rule.txt   # 条番号で探す
```

注意: 表組みや図の周りで、文が行の途中で折れる(例: 「ジャスト／ダイバー」のように単語が分かれる)。単語で検索して0件でも、**欠落とは限らない**。

## 4. 公式サイトの構成(観察)

- `/rule/rulechange/` — 総合ルール PDF へのリンク、更新履歴、各回の「変更点」、FAQ 回答変更のお知らせ。
- `/rule/qa/` — Q&A の一覧(日付順、ページ送り `/rule/qa/page/{n}/`)。カテゴリ分けや検索欄はない。
- `/rule/qa/{番号}/` — 個別の Q&A。ページの下に**関連する質問**が並ぶ(回答は、その質問のページで見る)。
- `/card/detail/?id={カードID}` — カードの詳細。テキスト全文と、そのカードの FAQ へのリンク。
- 「競技ルール」専用のページは無く、競技イベント運営ルールは `/rule/rulechange/` の PDF 一覧にある。

## 5. 更新の確認

- 月に1回、または実装の区切りで、<https://dm.takaratomy.co.jp/rule/rulechange/> の「更新履歴」を見て、**この文書の版(Ver.1.52)より新しい版が出ていないか**確認する。
- 新しい版が出たら、変更点ページを読み、[rules-reference.md](./rules-reference.md) 第9章と第10章(照合)を更新する。
