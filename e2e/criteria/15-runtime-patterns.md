# Runtime Patterns & Common Bugs

## React StrictMode Double-Mount
1. Every useEffect that calls an async function (fetch, generate, load) must be guarded against double-invocation
2. Pattern: use a ref flag (`inFlight.current`) that prevents concurrent execution
3. Check: search for `useEffect` + `fetch` or `generate` or `load` without a guard ref
4. All async generators (RG, IG, chat) must have `inFlight` guards

## Race Conditions
5. State updates from async callbacks must check if the component is still mounted (`cancelled` flag)
6. Multiple rapid clicks on action buttons (Select, Dismiss, Generate) must be debounced or guarded
7. Streaming parsers that call `setItems` must not race with other `setItems` calls

## Stale Closures
8. Refs used in callbacks (undoDismissRef, chatInputRef) must be updated on every render or use `useCallback`
9. `useEffect` dependency arrays must include all referenced state variables
10. Timer callbacks (setTimeout, setInterval) must not reference stale state

## State Sync
11. When state lives in a child component (items in BrainstormView) and parent needs to modify it, use ref callbacks — not prop drilling through intermediate state
12. `onItemsChange` callbacks that filter data (e.g. only tier1) lose information — parent state diverges from child
13. After a soft delete (dismissed: true), all filters/counts/selections must check the flag

## Network & API
14. Edge function calls must have timeouts (AbortController)
15. Failed API calls must not leave UI in a loading state forever
16. Streaming responses must handle truncation gracefully (partial JSON)
17. Cache writes (fire-and-forget) must not block the response

## Undo Safety
18. Undo data must survive page refresh — either persisted to DB or reconstructable from DB state
19. Soft-deleted items must remain in DB with a flag, not hard-deleted
20. Undo messages in chat must reference IDs, not snapshots (snapshots become stale)
