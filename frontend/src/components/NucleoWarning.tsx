interface NucleoWarningProps {
  isCore: boolean | null | undefined;
}

export function NucleoWarning({ isCore }: NucleoWarningProps) {
  if (!isCore) return null;
  return (
    <span className="badge badge-warn" role="status">
      ⚠ Núcleo Environ
    </span>
  );
}
