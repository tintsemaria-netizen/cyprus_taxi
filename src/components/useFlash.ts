'use client';

import { useEffect, useState } from 'react';

// A notice that shows for `ms` and then goes away by itself (operator 2026-11-27: «на 3 секунды, потом пропадать,
// как везде подобные объявления»). It shows again when `key` changes (e.g. another territory); null = nothing.
export function useFlash(key: string | null, ms = 3000): boolean {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!key) { setShown(null); return; }
    setShown(key);
    const id = setTimeout(() => setShown((k) => (k === key ? null : k)), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return !!key && shown === key;
}
