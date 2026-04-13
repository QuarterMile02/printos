export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type OrgRole = 'owner' | 'admin' | 'designer' | 'accountant' | 'member' | 'viewer'
export type OrgPlan = 'free' | 'pro' | 'enterprise'
export type InviteStatus = 'pending' | 'accepted' | 'expired'
export type JobStatus = 'new' | 'in_progress' | 'proof_review' | 'ready_for_pickup' | 'completed'
export type JobFlag = 'file_error' | 'help_needed'
// Phase 8 statuses. 'sent' and 'declined' are legacy values that remain
// in the enum (Postgres can't drop enum members) but are remapped to
// 'delivered' and 'lost' respectively by migration 018b. Don't write
// 'sent' or 'declined' for new quotes.
export type QuoteStatus =
  | 'draft'
  | 'delivered'
  | 'customer_review'
  | 'approved'
  | 'internally_approved'
  | 'approve_with_changes'
  | 'revise'
  | 'ordered'
  | 'hold'
  | 'expired'
  | 'lost'
  | 'pending'
  | 'no_charge'
  // Legacy — kept so type narrowing still works against historical rows.
  | 'sent'
  | 'declined'

export type SalesOrderStatus =
  | 'new'
  | 'in_process'
  | 'completed'
  | 'hold'
  | 'no_charge'
  | 'no_charge_approved'
  | 'void'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          plan: OrgPlan
          logo_url: string | null
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          plan?: OrgPlan
          logo_url?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          plan?: OrgPlan
          logo_url?: string | null
          settings?: Json
          updated_at?: string
        }
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: OrgRole
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role?: OrgRole
          created_at?: string
        }
        Update: {
          role?: OrgRole
        }
      }
      organization_invites: {
        Row: {
          id: string
          organization_id: string
          email: string
          role: OrgRole
          token: string
          status: InviteStatus
          invited_by: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          email: string
          role?: OrgRole
          token?: string
          status?: InviteStatus
          invited_by: string
          expires_at?: string
          created_at?: string
        }
        Update: {
          status?: InviteStatus
        }
      }
      jobs: {
        Row: {
          id: string
          organization_id: string
          customer_id: string | null
          job_number: number
          title: string
          description: string | null
          status: JobStatus
          flag: JobFlag | null
          due_date: string | null
          source_quote_id: string | null
          assigned_to: string | null
          needs_revision: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          customer_id?: string | null
          job_number?: number
          title: string
          description?: string | null
          status?: JobStatus
          flag?: JobFlag | null
          due_date?: string | null
          source_quote_id?: string | null
          assigned_to?: string | null
          needs_revision?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          customer_id?: string | null
          title?: string
          description?: string | null
          status?: JobStatus
          flag?: JobFlag | null
          due_date?: string | null
          source_quote_id?: string | null
          assigned_to?: string | null
          needs_revision?: boolean
          updated_at?: string
        }
      }
      customers: {
        Row: {
          id: string
          organization_id: string
          first_name: string
          last_name: string
          company_name: string | null
          email: string | null
          phone: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          first_name: string
          last_name: string
          company_name?: string | null
          email?: string | null
          phone?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          first_name?: string
          last_name?: string
          company_name?: string | null
          email?: string | null
          phone?: string | null
          notes?: string | null
          updated_at?: string
        }
      }
      quotes: {
        Row: {
          id: string
          organization_id: string
          customer_id: string | null
          quote_number: number
          title: string
          description: string | null
          status: QuoteStatus
          needs_pricing_approval: boolean
          needs_rescue: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          customer_id?: string | null
          quote_number?: number
          title: string
          description?: string | null
          status?: QuoteStatus
          needs_pricing_approval?: boolean
          needs_rescue?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          customer_id?: string | null
          title?: string
          description?: string | null
          status?: QuoteStatus
          needs_pricing_approval?: boolean
          needs_rescue?: boolean
          updated_at?: string
        }
      }
      quote_line_items: {
        Row: {
          id: string
          quote_id: string
          description: string
          quantity: number
          unit_price: number
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          description: string
          quantity?: number
          unit_price?: number
          sort_order?: number
          created_at?: string
        }
        Update: {
          description?: string
          quantity?: number
          unit_price?: number
          sort_order?: number
        }
      }
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string | null
          avatar_url?: string | null
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_organizations: {
        Args: { user_id: string }
        Returns: {
          organization_id: string
          organization_name: string
          organization_slug: string
          role: OrgRole
        }[]
      }
    }
    Enums: {
      org_role: OrgRole
      org_plan: OrgPlan
      invite_status: InviteStatus
      job_status: JobStatus
      job_flag: JobFlag
      quote_status: QuoteStatus
    }
  }
}

// Convenience row types
export type Organization = Database['public']['Tables']['organizations']['Row']
export type OrganizationMember = Database['public']['Tables']['organization_members']['Row']
export type OrganizationInvite = Database['public']['Tables']['organization_invites']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Customer = Database['public']['Tables']['customers']['Row']
export type Job = Database['public']['Tables']['jobs']['Row']
export type Quote = Database['public']['Tables']['quotes']['Row']
export type QuoteLineItem = Database['public']['Tables']['quote_line_items']['Row']
