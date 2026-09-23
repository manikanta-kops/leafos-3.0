import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
export function useScrollHistory(
  ref: RefObject<HTMLDivElement | null>,
  identity: string,
  revision: string,
  ready: boolean,
) {
  const near = useRef(false)
  const prior = useRef({ identity, height: 0, revision, ready: false })
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const [unread, setUnread] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const onScroll = () => {
      near.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 90
      if (near.current) setUnread(false)
    }
    element.addEventListener('scroll', onScroll)
    return () => element.removeEventListener('scroll', onScroll)
  }, [ref, identity])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (prior.current.identity !== identity) {
      element.scrollTop = 0
      near.current = false
      setUnread(false)
      anchor.current = null
    } else if (anchor.current) {
      element.scrollTop =
        anchor.current.top + (element.scrollHeight - anchor.current.height)
      anchor.current = null
    } else if (
      prior.current.ready &&
      ready &&
      prior.current.revision !== revision &&
      prior.current.height &&
      element.scrollHeight !== prior.current.height
    ) {
      if (near.current) element.scrollTop = element.scrollHeight
      else setUnread(true)
    }
    prior.current = { identity, height: element.scrollHeight, revision, ready }
  }, [identity, revision, ref, ready])
  return {
    unread,
    older: () => {
      const el = ref.current
      if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop }
    },
    cancelAnchor: () => {
      anchor.current = null
    },
    latest: () => {
      const el = ref.current
      if (el) el.scrollTop = el.scrollHeight
      near.current = true
      setUnread(false)
    },
  }
}
