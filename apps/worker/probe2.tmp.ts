import { readEventCandidate } from './src/listings/read-event.js'
import { fetchChiefDelphiTopic } from './src/connectors/discourse.js'
const detail = await fetchChiefDelphiTopic(521638)
const text = detail!.raw || detail!.html.replace(/<[^>]+>/g, ' ')
const out = await readEventCandidate({
  threadUrl: 'https://www.chiefdelphi.com/t/beach-blitz-2026/521638',
  title: detail!.title ?? '', threadText: text, website: 'https://beachblitz.org',
})
require('fs').writeFileSync('/tmp/probe2.json', JSON.stringify(out, null, 1))
