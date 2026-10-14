# CLAUDE.md(DM_SIM の作業ルール)

デュエル・マスターズをブラウザで遊べるシミュレータ(CPU対戦・確率調査・パターン調査)。
設計・仕様は [docs/](./docs/)、作業の進捗は [ROADMAP.md](./ROADMAP.md) が正。

## 最重要: 機能ごとに git コミットする

**1つの機能(ROADMAP の1項目、またはひとまとまりの変更)ができたら、その都度コミットする。**
まとめて大きく1回でコミットしない。作業が長くなっても、区切りごとに履歴に残す。

1. 機能を実装する(1コミット = 1つの目的。無関係な変更を混ぜない)。
2. 確認する: `npm run typecheck` と `npm test`(UIを触ったら `npm run build` と実機確認)。
3. ROADMAP.md の該当項目を `[x]` にする(**その機能と同じコミットに含める**)。
4. `git add <対象ファイル>` で、**その機能のファイルだけ**を明示的に追加する(`git add .` / `git add -A` は避ける)。
5. コミットする。メッセージは下記の形式。

### コミットの粒度の目安

| 種類 | 例 |
|---|---|
| 1機能 = 1コミット | 「置換パイプラインを追加」「デドダムのカード定義とシナリオテスト」 |
| テストは対象と同じコミット | 機能のコードとそのテストを一緒にコミットする |
| 文書だけの変更は別コミット | `docs:` を付けて、コードの変更と分ける |
| 設定・基盤は別コミット | `chore:` で依存追加・設定変更を分ける |
| リファクタは別コミット | 挙動を変える変更と混ぜない |

壊れた状態(型エラー・テスト失敗)のままコミットしない。途中の保存が必要なときは、作業ブランチで `wip:` を付ける。

### コミットメッセージ

```
<種類>(<範囲>): <日本語の要約(50字程度まで)>

<必要なら、なぜその変更をしたか・注意点を日本語で>

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

- 種類: `feat` 機能 / `fix` 不具合修正 / `test` テスト / `docs` 文書 / `refactor` / `chore` 設定・依存 / `perf` 性能
- 範囲の例: `engine` / `cards` / `ai` / `sim` / `ui` / `cli` / `roadmap`
- 例: `feat(engine): 置換パイプラインを追加し、EXライフの身代わりに対応`

### してはいけないこと

- `git push --force`、公開済みのコミットの `--amend` / `rebase`(明示的に頼まれた場合を除く)
- `--no-verify` や署名の無効化
- `node_modules/` / `dist/` / 生成物 / 秘密情報のコミット
- 1つのコミットに、無関係な複数の機能を詰め込むこと

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー(Vite) |
| `npm test` | Vitest(engine・カード・AI・シミュレータ) |
| `npm run typecheck` | 型チェック(`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm run build` | 型チェック+ビルド |
| `npm run batch -- --deckA maruru --deckB zardy --games 1000 --seed 1` | AI同士のバッチ対戦(CLI) |
| `npm run prob -- ...` | 確率調査・パターン調査(CLI) |
| `npm run aibench -- --games 100 --iterations 120 --seed 1` | AI の強さの測定(モンテカルロ 対 ルールベース、勝率と95%区間。`--w hand=1.2 --prior 0` などで調整) |
| `npm run tune-eval -- --games 100 --rounds 2` | 評価関数の重みの座標降下(自己対戦。時間がかかる) |
| `npm run build:wasm` | Rust 版エンジンを WASM にビルドして `src/wasm/dmsim.wasm` に置く(要 Rust。あれば AI の探索が自動で使う。無ければ TS 版) |
| `cargo test --release`(`rust/` で) | Rust 版と TS 版の差分テスト(先に `npx tsx scripts/dump-fixtures.ts rust/fixtures/games.json`) |

注意: この環境(Windows)では `python` / `python3` は Microsoft Store のスタブで動かない。Python が必要なときは `py` で実行する(例: `py script.py`)。

## コードの決まり(docs の要約)

- **engine は純TypeScript**。DOM・React・Worker・`ai/` `sim/` `ui/` に依存しない(ESLintで禁止)。
- **`rust/` は engine と AI のプレイアウトの Rust 版**(探索のラウンド評価を高速化する。TS 版が基準)。ルール・カード効果・プレイアウトの手順を変えたら、Rust 版にも反映し、`scripts/dump-fixtures.ts` で正解データを作り直して、`cargo test --release` と `npm test`(`tests/wasm`)を通す。`DM_WASM=off` で TS 版だけで動かして比べられる。
- 状態は **JSON互換**。`step(state, action)` は純粋関数(入力を書き換えない)。乱数は状態内のシード付きPRNG。
- カード効果は **データ(AST)** で書く(`src/cards/data/*.json`)。エンジンのコードを触るのは「原始操作が足りない時」だけ。
- **質問(`ask`)は状態を変更する前に行う**。再実行しても二重に変更されない(effects 6.5 の再開可能な実行)。
- **選択の余地がない質問は出さない(自明なら自動で進める)**。選択がある時だけ聞く。判定はエンジン側の関数にしてテストで固定する(例: `payChoice`。effects 11.6)。
- 新しいカード能力を足したら、`tests/cards/` にシナリオテストを書く。ルールの不明点は ROADMAP の「要確認ルール台帳」(L1〜)に記録する。
- UI・ログは日本語。カード画像は当面なし(テキスト表示)。

## 作業の進め方

- 着手前に ROADMAP.md の未完了項目を確認し、依存の順(M0 → M1 → …)に進める。
- docs の内容を変えたら(仕様変更・確認で判明した事実)、`docs:` コミットで反映する。
- 不確かなルールは推測で固定せず、台帳に書いて、テストか設定(`GameConfig`)で切り替えられるようにする。
