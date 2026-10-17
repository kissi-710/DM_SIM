// CPU の手のレビュー表のページを組み立てる: scripts/review-template.html に、scripts/review-sample.ts の出力を埋め込む。
//   node scripts/review-build.mjs [入力=scratch/review/decisions.json] [出力=scratch/review/index.html]
// 公開は Artifact ツールで(capabilities: db と user。評価は reviews/<判断の番号> に保存される)。
import { readFileSync, writeFileSync } from 'node:fs';

const [input = 'scratch/review/decisions.json', output = 'scratch/review/index.html'] = process.argv.slice(2);
const template = readFileSync(new URL('./review-template.html', import.meta.url), 'utf8');
const marker = '/*__DATA__*/[]/*__END__*/';
if (!template.includes(marker)) throw new Error('テンプレートにデータの差し込み位置がありません');
// データ内の < は、script を閉じてしまわないよう文字参照にする
const data = readFileSync(input, 'utf8').replace(/</g, '\u003c');
writeFileSync(output, template.replace(marker, () => data));
console.log(`出力 ${output}`);
