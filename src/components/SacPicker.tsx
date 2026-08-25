'use client';
import { Input, Select } from './ui';
import { resolveSacCodes, sacOptionLabel, type SacCode } from '@/lib/sac';

const OTHER = '__other__';

export function SacPicker({
  value, onChange, codes, compact = true, allowOther = true,
}: {
  value: string;
  onChange: (code: string) => void;
  codes?: unknown;
  compact?: boolean;
  allowOther?: boolean;
}) {
  const list = resolveSacCodes(codes);
  const v = (value ?? '').trim();
  const inList = list.some((s) => s.code === v);
  const selectValue = inList ? v : OTHER;

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${compact ? '' : 'w-full'}`}>
      <Select
        className={compact ? 'input-compact min-w-[13.5rem] max-w-[20rem]' : ''}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) onChange(inList ? '' : v);
          else onChange(next);
        }}
        title={list.find((s) => s.code === v)?.label ?? 'SAC code'}>
        {list.map((s) => (
          <option key={s.code} value={s.code} title={s.label}>{sacOptionLabel(s)}</option>
        ))}
        {allowOther && <option value={OTHER}>Other…</option>}
      </Select>
      {allowOther && selectValue === OTHER && (
        <Input
          className={`${compact ? 'input-compact' : ''} input-mono w-[6.5rem]`}
          placeholder="Code"
          value={v}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
        />
      )}
    </div>
  );
}

export function SacCodesEditor({
  value, onChange,
}: {
  value: SacCode[];
  onChange: (next: SacCode[]) => void;
}) {
  const rows = value.length ? value : [{ code: '', tag: '', label: '' }];
  const patch = (i: number, p: Partial<SacCode>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input className="input-mono w-[7rem]" placeholder="998313" value={row.code}
            onChange={(e) => patch(i, { code: e.target.value.replace(/\s/g, '') })} />
          <Input className="w-[8rem]" placeholder="Tag" value={row.tag}
            onChange={(e) => patch(i, { tag: e.target.value })} />
          <Input className="min-w-[12rem] flex-1" placeholder="Full name" value={row.label}
            onChange={(e) => patch(i, { label: e.target.value })} />
          <button type="button" className="btn-subtle btn-xs text-red-400" disabled={rows.length === 1}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>Remove</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost btn-xs"
          onClick={() => onChange([...rows, { code: '', tag: '', label: '' }])}>Add SAC</button>
        <button type="button" className="btn-ghost btn-xs"
          onClick={() => onChange(resolveSacCodes(null))}>Reset built-in three</button>
      </div>
    </div>
  );
}
