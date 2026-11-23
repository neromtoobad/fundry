import { useEffect, useState, useCallback, useRef } from "react";

/** Run an async loader, re-run on deps change or when reload() is called. Optional polling. */
export function useAsync(fn, deps = [], pollMs = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let timer;
    const run = () =>
      fn()
        .then((data) => alive.current && setState({ data, error: null, loading: false }))
        .catch((error) => alive.current && setState((s) => ({ data: s.data, error, loading: false })))
        .finally(() => { if (pollMs && alive.current) timer = setTimeout(run, pollMs); });
    run();
    return () => { alive.current = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
