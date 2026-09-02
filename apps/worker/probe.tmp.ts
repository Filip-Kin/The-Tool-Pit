import { readEventCandidate } from './src/listings/read-event.js'
import { fetchChiefDelphiTopic } from './src/connectors/discourse.js'

const topicId = Number(process.argv[2] ?? 521638)
const detail = await fetchChiefDelphiTopic(topicId)
if (!detail) { console.error('no topic'); process.exit(1) }
const text = detail.raw || detail.html.replace(/<[^>]+>/g, ' ')
const site = (text.match(/https?:\/\/[^\s)"']+/g) ?? []).find((u) => !u.includes('chiefdelphi'))

const out = await readEventCandidate({
  threadUrl: `https://www.chiefdelphi.com/t/${topicId}`,
  title: detail.title ?? '',
  threadText: text,
  website: site,
})
require("fs").writeFileSync("/tmp/probe-out.json", JSON.stringify(out, null, 1))
