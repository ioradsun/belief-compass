export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      feed_events: {
        Row: {
          created_at: string
          event_key: string
          id: number
          occurred_at: string
          onchain_id: number | null
          payload: Json | null
          side: string | null
          type: string
          wallet: string | null
        }
        Insert: {
          created_at?: string
          event_key: string
          id?: number
          occurred_at: string
          onchain_id?: number | null
          payload?: Json | null
          side?: string | null
          type: string
          wallet?: string | null
        }
        Update: {
          created_at?: string
          event_key?: string
          id?: number
          occurred_at?: string
          onchain_id?: number | null
          payload?: Json | null
          side?: string | null
          type?: string
          wallet?: string | null
        }
        Relationships: []
      }
      ingest_state: {
        Row: {
          id: number
          last_block: number | null
          lease_expires_at: string | null
          lease_owner: string | null
        }
        Insert: {
          id?: number
          last_block?: number | null
          lease_expires_at?: string | null
          lease_owner?: string | null
        }
        Update: {
          id?: number
          last_block?: number | null
          lease_expires_at?: string | null
          lease_owner?: string | null
        }
        Relationships: []
      }
      market_state: {
        Row: {
          believers_mixed: number
          believers_no: number
          believers_yes: number
          boost_score: number | null
          chg_1h: number | null
          chg_24h: number | null
          divergence: number | null
          money_yes_pct: number | null
          new_believers_1h: number
          no_price_usd: number | null
          onchain_id: number
          people_yes_pct: number | null
          trending_score: number | null
          updated_at: string
          velocity_5m: number
          volume_total_usd: number | null
          yes_price_usd: number | null
        }
        Insert: {
          believers_mixed?: number
          believers_no?: number
          believers_yes?: number
          boost_score?: number | null
          chg_1h?: number | null
          chg_24h?: number | null
          divergence?: number | null
          money_yes_pct?: number | null
          new_believers_1h?: number
          no_price_usd?: number | null
          onchain_id: number
          people_yes_pct?: number | null
          trending_score?: number | null
          updated_at?: string
          velocity_5m?: number
          volume_total_usd?: number | null
          yes_price_usd?: number | null
        }
        Update: {
          believers_mixed?: number
          believers_no?: number
          believers_yes?: number
          boost_score?: number | null
          chg_1h?: number | null
          chg_24h?: number | null
          divergence?: number | null
          money_yes_pct?: number | null
          new_believers_1h?: number
          no_price_usd?: number | null
          onchain_id?: number
          people_yes_pct?: number | null
          trending_score?: number | null
          updated_at?: string
          velocity_5m?: number
          volume_total_usd?: number | null
          yes_price_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_state_onchain_id_fkey"
            columns: ["onchain_id"]
            isOneToOne: true
            referencedRelation: "markets"
            referencedColumns: ["onchain_id"]
          },
        ]
      }
      markets: {
        Row: {
          agent_opinions: Json | null
          author_name: string | null
          author_pfp: string | null
          author_wallet: string | null
          category: string | null
          created_at: string | null
          first_seen: string
          onchain_id: number
          our_metadata: Json | null
          pov_uuid: string | null
          source: string
          title: string | null
        }
        Insert: {
          agent_opinions?: Json | null
          author_name?: string | null
          author_pfp?: string | null
          author_wallet?: string | null
          category?: string | null
          created_at?: string | null
          first_seen?: string
          onchain_id: number
          our_metadata?: Json | null
          pov_uuid?: string | null
          source?: string
          title?: string | null
        }
        Update: {
          agent_opinions?: Json | null
          author_name?: string | null
          author_pfp?: string | null
          author_wallet?: string | null
          category?: string | null
          created_at?: string | null
          first_seen?: string
          onchain_id?: number
          our_metadata?: Json | null
          pov_uuid?: string | null
          source?: string
          title?: string | null
        }
        Relationships: []
      }
      price_snapshots: {
        Row: {
          captured_at: string
          money_yes_pct: number | null
          onchain_id: number
          yes_price_usd: number | null
        }
        Insert: {
          captured_at?: string
          money_yes_pct?: number | null
          onchain_id: number
          yes_price_usd?: number | null
        }
        Update: {
          captured_at?: string
          money_yes_pct?: number | null
          onchain_id?: number
          yes_price_usd?: number | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          block_hash: string
          block_number: number
          direction: string
          eth_amount: number
          log_index: number
          onchain_id: number
          raw_log: Json | null
          side: string
          token_amount: number
          ts: string
          tx_hash: string
          wallet: string
        }
        Insert: {
          block_hash: string
          block_number: number
          direction: string
          eth_amount: number
          log_index: number
          onchain_id: number
          raw_log?: Json | null
          side: string
          token_amount: number
          ts: string
          tx_hash: string
          wallet: string
        }
        Update: {
          block_hash?: string
          block_number?: number
          direction?: string
          eth_amount?: number
          log_index?: number
          onchain_id?: number
          raw_log?: Json | null
          side?: string
          token_amount?: number
          ts?: string
          tx_hash?: string
          wallet?: string
        }
        Relationships: []
      }
      user_events: {
        Row: {
          dwell_ms: number | null
          id: number
          onchain_id: number | null
          session_id: string | null
          ts: string
          type: string
          wallet: string | null
        }
        Insert: {
          dwell_ms?: number | null
          id?: number
          onchain_id?: number | null
          session_id?: string | null
          ts?: string
          type: string
          wallet?: string | null
        }
        Update: {
          dwell_ms?: number | null
          id?: number
          onchain_id?: number | null
          session_id?: string | null
          ts?: string
          type?: string
          wallet?: string | null
        }
        Relationships: []
      }
      wallet_beliefs: {
        Row: {
          conviction: number
          days_held: number
          directional_since: string | null
          expressed_side: string
          first_backed_at: string | null
          last_trade_at: string | null
          no_cost: number
          no_shares: number
          onchain_id: number
          stance: number | null
          stance_side: string | null
          updated_at: string
          wallet: string
          yes_cost: number
          yes_shares: number
        }
        Insert: {
          conviction?: number
          days_held?: number
          directional_since?: string | null
          expressed_side?: string
          first_backed_at?: string | null
          last_trade_at?: string | null
          no_cost?: number
          no_shares?: number
          onchain_id: number
          stance?: number | null
          stance_side?: string | null
          updated_at?: string
          wallet: string
          yes_cost?: number
          yes_shares?: number
        }
        Update: {
          conviction?: number
          days_held?: number
          directional_since?: string | null
          expressed_side?: string
          first_backed_at?: string | null
          last_trade_at?: string | null
          no_cost?: number
          no_shares?: number
          onchain_id?: number
          stance?: number | null
          stance_side?: string | null
          updated_at?: string
          wallet?: string
          yes_cost?: number
          yes_shares?: number
        }
        Relationships: []
      }
      wallet_denylist: {
        Row: {
          added_at: string
          reason: string | null
          wallet: string
        }
        Insert: {
          added_at?: string
          reason?: string | null
          wallet: string
        }
        Update: {
          added_at?: string
          reason?: string | null
          wallet?: string
        }
        Relationships: []
      }
      wallet_matches: {
        Row: {
          agreements: number
          calculated_at: string
          disagreements: number
          match_score: number
          matched_wallet: string
          shared_markets: number
          wallet: string
        }
        Insert: {
          agreements: number
          calculated_at?: string
          disagreements: number
          match_score: number
          matched_wallet: string
          shared_markets: number
          wallet: string
        }
        Update: {
          agreements?: number
          calculated_at?: string
          disagreements?: number
          match_score?: number
          matched_wallet?: string
          shared_markets?: number
          wallet?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
