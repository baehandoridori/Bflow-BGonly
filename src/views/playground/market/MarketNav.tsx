import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ArrowLeft, Landmark, Search, UserRound } from 'lucide-react';

import type { MarketRoute, PlaygroundAction } from '@/features/playground/routes';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

interface MarketNavProps {
  active: MarketRoute['kind'];
  onNavigate(action: PlaygroundAction): void;
  onBack(): void;
}

interface SearchResult {
  key: string;
  stockId: string;
  label: string;
  description: string;
}

export function MarketNav({ active, onNavigate, onBack }: MarketNavProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const browseRequestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rawId = useId();
  const listboxId = `market-search-${rawId.replace(/:/g, '')}`;
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');

  const results = useMemo<SearchResult[]>(() => {
    if (!snapshot || !normalizedQuery) return [];
    const stocks = snapshot.stocks
      .filter((stock) => (
        `${stock.name} ${stock.symbol} ${stock.character} ${stock.description}`
          .toLocaleLowerCase('ko-KR')
          .includes(normalizedQuery)
      ))
      .map((stock) => ({
        key: `stock-${stock.id}`,
        stockId: stock.id,
        label: stock.name,
        description: `${stock.symbol} · ${stock.character}`,
      }));
    const news = snapshot.news
      .filter((item) => (
        `${item.title} ${item.summary}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery)
      ))
      .map((item) => ({
        key: `news-${item.id}`,
        stockId: item.stockId,
        label: snapshot.stocks.find((stock) => stock.id === item.stockId)?.name ?? item.stockId,
        description: item.title,
      }));
    return [...stocks, ...news].slice(0, 8);
  }, [normalizedQuery, snapshot]);

  const activeOptionId = open && activeIndex >= 0 && activeIndex < results.length
    ? `${listboxId}-option-${activeIndex}`
    : undefined;

  useEffect(() => {
    setActiveIndex(-1);
    setOpen(Boolean(normalizedQuery));
  }, [normalizedQuery]);

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  useEffect(() => {
    setActiveIndex((index) => (index >= results.length ? -1 : index));
  }, [results.length]);

  const selectResult = (result: SearchResult) => {
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    onNavigate({ kind: 'open-stock', stockId: result.stockId });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter') {
      if (!open || activeIndex < 0 || !results[activeIndex]) return;
      event.preventDefault();
      selectResult(results[activeIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    }
  };

  const linkClass = (selected: boolean) => [
    'min-h-11 cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    selected
      ? 'bg-accent/15 text-text-primary'
      : 'text-text-secondary hover:bg-bg-border/45 hover:text-text-primary',
  ].join(' ');

  return (
    <nav className="relative z-20 shrink-0 border-b border-bg-border bg-bg-card/95 px-4 py-3 sm:px-6" aria-label="JBBJ 시장 내비게이션">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-text-primary">
            <Landmark aria-hidden="true" size={22} className="shrink-0 text-accent-sub" />
            <span className="truncate text-lg font-bold">JBBJ 시장</span>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/45 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            {active === 'home' ? '놀이터로' : '뒤로'}
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <button
              id="market-nav-home"
              type="button"
              aria-current={active === 'home' ? 'page' : undefined}
              onClick={() => onNavigate({ kind: 'market-home' })}
              className={linkClass(active === 'home')}
            >
              시장 홈
            </button>
            <button
              id="market-nav-browse"
              type="button"
              onClick={() => {
                browseRequestId.current += 1;
                onNavigate({
                  kind: 'market-home',
                  focusRequest: { target: 'all-stocks', id: browseRequestId.current },
                });
              }}
              className={linkClass(false)}
            >
              종목 둘러보기
            </button>
            <button
              id="market-nav-account"
              type="button"
              aria-current={active === 'account' ? 'page' : undefined}
              onClick={() => onNavigate({ kind: 'open-account' })}
              className={linkClass(active === 'account')}
            >
              <span className="inline-flex items-center gap-2">
                <UserRound aria-hidden="true" size={16} />
                내 계좌
              </span>
            </button>
          </div>

          <div className="relative min-w-0 flex-1 lg:ml-auto lg:max-w-sm">
            <label htmlFor={`${listboxId}-input`} className="sr-only">종목·뉴스 검색</label>
            <Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3 top-3.5 text-text-secondary" />
            <input
              ref={inputRef}
              id={`${listboxId}-input`}
              type="search"
              role="combobox"
              aria-label="종목·뉴스 검색"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeOptionId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setOpen(Boolean(normalizedQuery))}
              onBlur={() => {
                setOpen(false);
                setActiveIndex(-1);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="종목·뉴스 검색"
              className="h-11 w-full rounded-xl border border-bg-border bg-bg-primary/65 pl-10 pr-3 text-base text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35"
            />
            {open && normalizedQuery && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label="종목·뉴스 검색 결과"
                className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-bg-border bg-bg-card p-1 shadow-2xl"
              >
                {results.length > 0 ? results.map((result, index) => (
                  <li key={result.key} role="presentation">
                    <button
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activeIndex === index}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectResult(result)}
                      className={`flex min-h-11 w-full cursor-pointer flex-col items-start rounded-lg px-3 py-2 text-left transition-colors ${activeIndex === index ? 'bg-accent/15' : 'hover:bg-bg-border/45'}`}
                    >
                      <span className="text-sm font-semibold text-text-primary">{result.label}</span>
                      <span className="mt-0.5 max-w-full truncate text-xs text-text-secondary">{result.description}</span>
                    </button>
                  </li>
                )) : (
                  <li className="px-3 py-4 text-sm text-text-secondary">검색 결과가 없어요.</li>
                )}
              </ul>
            )}
            <span aria-live="polite" className="sr-only">
              {normalizedQuery ? `${results.length}개 검색 결과` : ''}
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}
