export function ipOrigin(props: { asName?: string; country?: string }): string {
  if (props.asName != null && props.country != null) return `${props.asName} · ${props.country}`;
  if (props.asName != null) return props.asName;
  if (props.country != null) return props.country;
  return "—";
}
