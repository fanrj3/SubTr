"use client";

import type { ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { Dialog } from "@base-ui/react/dialog";
import { Select } from "@base-ui/react/select";
import { Slider } from "@base-ui/react/slider";
import { Switch } from "@base-ui/react/switch";
import { ChevronDownIcon, XIcon } from "./icons";

export function SettingsSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[10px] border border-card-border bg-card ${className}`}
    >
      {children}
    </div>
  );
}

export function SettingsSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">
      {children}
    </h3>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  htmlFor,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`@container border-b border-card-border last:border-b-0 ${className}`}>
      <div className="flex flex-col gap-2 px-3.5 py-3 @min-[420px]:flex-row @min-[420px]:items-center @min-[420px]:justify-between @min-[420px]:gap-3">
        <div className="min-w-0 @min-[420px]:flex-1">
          <label htmlFor={htmlFor} className="block text-[13px] font-medium">
            {title}
          </label>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
          )}
        </div>
        {children && (
          <div className="min-w-0 w-full @min-[420px]:w-auto @min-[420px]:max-w-full">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsRowFull({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-card-border px-3.5 py-3 last:border-b-0">
      <label className="block text-[13px] font-medium">{title}</label>
      {description && (
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
      )}
      <div className="mt-2 min-w-0">{children}</div>
    </div>
  );
}

export function Advanced({
  label,
  children,
  defaultOpen = false,
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="border-b border-card-border last:border-b-0">
      <Collapsible.Trigger className="group flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left text-[13px] font-medium transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/[0.03]">
        {label}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-data-[panel-open]:rotate-180" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="px-3.5 pb-3">
        <div className="space-y-3">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function SettingsSwitch({
  checked,
  onCheckedChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-muted/40"
      }`}
    >
      <Switch.Thumb
        className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </Switch.Root>
  );
}

export function SettingsSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  "aria-label"?: string;
}) {
  return (
    <Slider.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => {
        const value = Array.isArray(next) ? next[0] : (next as number);
        onChange(value);
      }}
      className="flex w-full min-w-[8rem] items-center"
    >
      <Slider.Control className="relative flex h-5 w-full items-center">
        <Slider.Track className="relative h-1 w-full rounded-full bg-muted/30">
          <Slider.Indicator className="h-full rounded-full bg-accent" />
          <Slider.Thumb
            aria-label={ariaLabel}
            className="h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-card-border bg-background shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

export type SelectOption = { value: string; label: string };

export function SettingsSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]));
  return (
    <Select.Root
      value={value}
      items={items}
      onValueChange={(next) => onChange(next as string)}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={`inline-flex h-8 min-w-[9rem] items-center justify-between gap-2 rounded-lg border border-card-border bg-background px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${className}`}
      >
        <Select.Value />
        <Select.Icon className="text-muted">
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className="z-50 min-w-[var(--anchor-width)] overflow-hidden rounded-[10px] border border-card-border bg-card p-1 shadow-lg">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent-dim data-[highlighted]:text-foreground"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="text-accent">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-card-border bg-card p-5 shadow-lg transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          onClick={closeOnBackdrop ? undefined : (e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold tracking-tight">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded-md p-1 text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            >
              <XIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="text-sm leading-relaxed text-muted">
              {description}
            </Dialog.Description>
          )}
          {children && <div className="mt-3 space-y-3">{children}</div>}
          {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
