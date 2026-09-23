import type { Answer, Interaction } from '../../data/work'
export function answerText(answer: Answer, interaction?: Interaction) {
  if (answer.kind === 'choice')
    return `${interaction?.options.find((o) => o.id === answer.optionId)?.label ?? answer.optionId}${answer.text ? ` — ${answer.text}` : ''}`
  if (answer.kind === 'text') return answer.text
  if (answer.kind === 'dismiss') return 'Dismissed without an answer'
  return `${answer.kind === 'approve' ? 'Approved' : 'Declined'}${answer.comment ? ` — ${answer.comment}` : ''}`
}
