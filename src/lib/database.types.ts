/**
 * Hand-maintained mirror of supabase/migrations. Kept deliberately small: the
 * app only needs Row/Insert/Update shapes, and hand-writing them avoids a
 * codegen step in CI.
 *
 * If you change the SQL, change this file too.
 */

export type AppRole = "owner" | "editor" | "viewer";
export type HouseholdRole = "head" | "spouse" | "child" | "other";
export type ProjectKind = "directory" | "event";
export type SelectionMode = "all" | "tags" | "manual";
export type EntryType = "household" | "person";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  created_at: string;
};

export type HouseholdRow = {
  id: string;
  display_name: string;
  sort_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  anniversary: string | null;
  photo_path: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PersonRow = {
  id: string;
  household_id: string | null;
  household_role: HouseholdRole | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  anniversary: string | null;
  use_household_address: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  photo_path: string | null;
  notes: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TagRow = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
};

export type ProjectRow = {
  id: string;
  name: string;
  kind: ProjectKind;
  description: string | null;
  selection_mode: SelectionMode;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProjectEntryRow = {
  project_id: string;
  entry_type: EntryType;
  ref_id: string;
  position: number;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      households: Table<HouseholdRow>;
      people: Table<PersonRow>;
      tags: Table<TagRow>;
      projects: Table<ProjectRow>;
      household_tags: Table<{ household_id: string; tag_id: string }>;
      person_tags: Table<{ person_id: string; tag_id: string }>;
      project_tags: Table<{ project_id: string; tag_id: string }>;
      project_entries: Table<ProjectEntryRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
