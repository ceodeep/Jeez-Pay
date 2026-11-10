import { useCallback, useEffect, useRef, useState } from "react";
import { errText } from "./format";

/**
 * Runs an async loader whenever `key` changes, with stale-response protection.
 * `key` should be a string that encodes whatever the loader depends on.
 */
export function useApi(loader, key = "", fallbackError = "") {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const seq = useRef(0);
  const alive = useRef(true);

  const [state, setState] = useState({
    data: null,
    error: "",
    loading: true,
    loadedAt: 0,
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(
    async (quiet = false) => {
      const id = ++seq.current;
      if (!quiet) {
        setState((prev) => ({ ...prev, loading: true, error: "" }));
      }
      try {
        const data = await loaderRef.current();
        if (id !== seq.current || !alive.current) return;
        setState({ data, error: "", loading: false, loadedAt: Date.now() });
      } catch (err) {
        if (id !== seq.current || !alive.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errText(err, fallbackError),
        }));
      }
    },
    [fallbackError]
  );

  useEffect(() => {
    reload();
  }, [key, reload]);

  return { ...state, reload };
}
