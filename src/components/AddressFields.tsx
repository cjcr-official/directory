import type { AddressParts } from "@/lib/format";

interface Props {
  value: AddressParts;
  onChange: (patch: Partial<AddressParts>) => void;
  disabled?: boolean;
  idPrefix: string;
}

/** The address block, shared by the family and person forms. */
export function AddressFields({ value, onChange, disabled, idPrefix }: Props) {
  const set = (key: keyof AddressParts) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ [key]: event.target.value || null } as Partial<AddressParts>);

  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-line1`}>Street address</label>
        <input
          id={`${idPrefix}-line1`}
          type="text"
          autoComplete="address-line1"
          disabled={disabled}
          value={value.address_line1 ?? ""}
          onChange={set("address_line1")}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-line2`}>Apartment, suite, etc.</label>
        <input
          id={`${idPrefix}-line2`}
          type="text"
          autoComplete="address-line2"
          disabled={disabled}
          value={value.address_line2 ?? ""}
          onChange={set("address_line2")}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor={`${idPrefix}-city`}>City</label>
          <input
            id={`${idPrefix}-city`}
            type="text"
            autoComplete="address-level2"
            disabled={disabled}
            value={value.city ?? ""}
            onChange={set("city")}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-state`}>State</label>
          <input
            id={`${idPrefix}-state`}
            type="text"
            autoComplete="address-level1"
            disabled={disabled}
            value={value.state ?? ""}
            onChange={set("state")}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-postal`}>ZIP</label>
          <input
            id={`${idPrefix}-postal`}
            type="text"
            autoComplete="postal-code"
            disabled={disabled}
            value={value.postal_code ?? ""}
            onChange={set("postal_code")}
          />
        </div>
      </div>
    </>
  );
}
