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
      events: {
        Row: {
          action: string | null
          amount_eth: number | null
          block_hash: string | null
          block_number: number | null
          chain_id: number | null
          created_at: string
          id: string
          ingested_at: string
          is_canonical: boolean
          kind: string
          log_index: number | null
          market_id: string | null
          occurred_at: string
          orphaned_at: string | null
          payload: Json
          price: number | null
          shares: number | null
          side: string | null
          source: string
          source_key: string
          tx_hash: string | null
          wallet: string | null
        }
        Insert: {
          action?: string | null
          amount_eth?: number | null
          block_hash?: string | null
          block_number?: number | null
          chain_id?: number | null
          created_at?: string
          id?: string
          ingested_at?: string
          is_canonical?: boolean
          kind: string
          log_index?: number | null
          market_id?: string | null
          occurred_at: string
          orphaned_at?: string | null
          payload?: Json
          price?: number | null
          shares?: number | null
          side?: string | null
          source: string
          source_key: string
          tx_hash?: string | null
          wallet?: string | null
        }
        Update: {
          action?: string | null
          amount_eth?: number | null
          block_hash?: string | null
          block_number?: number | null
          chain_id?: number | null
          created_at?: string
          id?: string
          ingested_at?: string
          is_canonical?: boolean
          kind?: string
          log_index?: number | null
          market_id?: string | null
          occurred_at?: string
          orphaned_at?: string | null
          payload?: Json
          price?: number | null
          shares?: number | null
          side?: string | null
          source?: string
          source_key?: string
          tx_hash?: string | null
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
      market_refresh_queue: {
        Row: {
          activity_dirty: boolean
          attempts: number
          last_error: string | null
          market_id: number
          positions_dirty: boolean
          pov_dirty: boolean
          requested_at: string
        }
        Insert: {
          activity_dirty?: boolean
          attempts?: number
          last_error?: string | null
          market_id: number
          positions_dirty?: boolean
          pov_dirty?: boolean
          requested_at?: string
        }
        Update: {
          activity_dirty?: boolean
          attempts?: number
          last_error?: string | null
          market_id?: number
          positions_dirty?: boolean
          pov_dirty?: boolean
          requested_at?: string
        }
        Relationships: []
      }
      market_state: {
        Row: {
          active_positions: number
          avg_conviction_strength: number | null
          avg_directional_days: number | null
          believers_mixed: number
          believers_no: number
          believers_yes: number
          boost_score: number | null
          buy_count_1h: number
          buy_count_24h: number
          buy_sell_ratio_24h: number | null
          calculated_at: string | null
          capital_held_no: number | null
          capital_held_total: number | null
          capital_held_yes: number | null
          chg_1h: number | null
          chg_24h: number | null
          chg_24h_no: number | null
          chg_24h_yes: number | null
          circulation_1h: number | null
          circulation_24h: number | null
          circulation_7d: number | null
          directional_believers: number
          divergence: number | null
          events_updated_at: string | null
          first_trade_at: string | null
          inactive_for_seconds: number | null
          last_position_change_at: string | null
          last_trade_at: string | null
          live_line: string | null
          live_line_kind: string | null
          live_line_occurred_at: string | null
          live_line_payload: Json | null
          live_line_window: string | null
          market_age_days: number | null
          market_created_at: string | null
          median_conviction_strength: number | null
          median_directional_days: number | null
          money_yes_pct: number | null
          needs_rebuild: boolean
          new_believers_1h: number
          new_believers_24h: number
          new_believers_7d: number
          no_capital_usd: number | null
          no_price_usd: number | null
          onchain_id: number
          opportunity_calculated_at: string | null
          opportunity_confidence: string | null
          opportunity_eligible: boolean
          opportunity_engine_version: number
          opportunity_evidence: Json | null
          opportunity_ineligible_reason: string | null
          opportunity_previous_type: string | null
          opportunity_reason: string | null
          opportunity_reason_code: string | null
          opportunity_sample_size: number | null
          opportunity_score: number | null
          opportunity_score_raw: number | null
          opportunity_type: string | null
          opportunity_type_since: string | null
          opportunity_window: string | null
          p75_directional_days: number | null
          people_no_pct: number | null
          people_yes_change_24h: number | null
          people_yes_pct: number | null
          positions_updated_at: string | null
          pov_updated_at: string | null
          read_model_version: number
          rebuild_reason: string | null
          sell_count_1h: number
          sell_count_24h: number
          sell_rate_24h: number | null
          side_balance: number | null
          side_flips_24h: number
          trade_count_1h: number
          trade_count_24h: number
          trade_count_7d: number
          trending_score: number | null
          unique_wallets_1h: number
          unique_wallets_24h: number
          unique_wallets_7d: number
          updated_at: string
          velocity_5m: number
          volume_24h_usd: number | null
          volume_eth_1h: number
          volume_eth_24h: number
          volume_eth_7d: number
          volume_total_usd: number | null
          yes_capital_usd: number | null
          yes_price_change_1h: number | null
          yes_price_change_24h: number | null
          yes_price_change_7d: number | null
          yes_price_usd: number | null
        }
        Insert: {
          active_positions?: number
          avg_conviction_strength?: number | null
          avg_directional_days?: number | null
          believers_mixed?: number
          believers_no?: number
          believers_yes?: number
          boost_score?: number | null
          buy_count_1h?: number
          buy_count_24h?: number
          buy_sell_ratio_24h?: number | null
          calculated_at?: string | null
          capital_held_no?: number | null
          capital_held_total?: number | null
          capital_held_yes?: number | null
          chg_1h?: number | null
          chg_24h?: number | null
          chg_24h_no?: number | null
          chg_24h_yes?: number | null
          circulation_1h?: number | null
          circulation_24h?: number | null
          circulation_7d?: number | null
          directional_believers?: number
          divergence?: number | null
          events_updated_at?: string | null
          first_trade_at?: string | null
          inactive_for_seconds?: number | null
          last_position_change_at?: string | null
          last_trade_at?: string | null
          live_line?: string | null
          live_line_kind?: string | null
          live_line_occurred_at?: string | null
          live_line_payload?: Json | null
          live_line_window?: string | null
          market_age_days?: number | null
          market_created_at?: string | null
          median_conviction_strength?: number | null
          median_directional_days?: number | null
          money_yes_pct?: number | null
          needs_rebuild?: boolean
          new_believers_1h?: number
          new_believers_24h?: number
          new_believers_7d?: number
          no_capital_usd?: number | null
          no_price_usd?: number | null
          onchain_id: number
          opportunity_calculated_at?: string | null
          opportunity_confidence?: string | null
          opportunity_eligible?: boolean
          opportunity_engine_version?: number
          opportunity_evidence?: Json | null
          opportunity_ineligible_reason?: string | null
          opportunity_previous_type?: string | null
          opportunity_reason?: string | null
          opportunity_reason_code?: string | null
          opportunity_sample_size?: number | null
          opportunity_score?: number | null
          opportunity_score_raw?: number | null
          opportunity_type?: string | null
          opportunity_type_since?: string | null
          opportunity_window?: string | null
          p75_directional_days?: number | null
          people_no_pct?: number | null
          people_yes_change_24h?: number | null
          people_yes_pct?: number | null
          positions_updated_at?: string | null
          pov_updated_at?: string | null
          read_model_version?: number
          rebuild_reason?: string | null
          sell_count_1h?: number
          sell_count_24h?: number
          sell_rate_24h?: number | null
          side_balance?: number | null
          side_flips_24h?: number
          trade_count_1h?: number
          trade_count_24h?: number
          trade_count_7d?: number
          trending_score?: number | null
          unique_wallets_1h?: number
          unique_wallets_24h?: number
          unique_wallets_7d?: number
          updated_at?: string
          velocity_5m?: number
          volume_24h_usd?: number | null
          volume_eth_1h?: number
          volume_eth_24h?: number
          volume_eth_7d?: number
          volume_total_usd?: number | null
          yes_capital_usd?: number | null
          yes_price_change_1h?: number | null
          yes_price_change_24h?: number | null
          yes_price_change_7d?: number | null
          yes_price_usd?: number | null
        }
        Update: {
          active_positions?: number
          avg_conviction_strength?: number | null
          avg_directional_days?: number | null
          believers_mixed?: number
          believers_no?: number
          believers_yes?: number
          boost_score?: number | null
          buy_count_1h?: number
          buy_count_24h?: number
          buy_sell_ratio_24h?: number | null
          calculated_at?: string | null
          capital_held_no?: number | null
          capital_held_total?: number | null
          capital_held_yes?: number | null
          chg_1h?: number | null
          chg_24h?: number | null
          chg_24h_no?: number | null
          chg_24h_yes?: number | null
          circulation_1h?: number | null
          circulation_24h?: number | null
          circulation_7d?: number | null
          directional_believers?: number
          divergence?: number | null
          events_updated_at?: string | null
          first_trade_at?: string | null
          inactive_for_seconds?: number | null
          last_position_change_at?: string | null
          last_trade_at?: string | null
          live_line?: string | null
          live_line_kind?: string | null
          live_line_occurred_at?: string | null
          live_line_payload?: Json | null
          live_line_window?: string | null
          market_age_days?: number | null
          market_created_at?: string | null
          median_conviction_strength?: number | null
          median_directional_days?: number | null
          money_yes_pct?: number | null
          needs_rebuild?: boolean
          new_believers_1h?: number
          new_believers_24h?: number
          new_believers_7d?: number
          no_capital_usd?: number | null
          no_price_usd?: number | null
          onchain_id?: number
          opportunity_calculated_at?: string | null
          opportunity_confidence?: string | null
          opportunity_eligible?: boolean
          opportunity_engine_version?: number
          opportunity_evidence?: Json | null
          opportunity_ineligible_reason?: string | null
          opportunity_previous_type?: string | null
          opportunity_reason?: string | null
          opportunity_reason_code?: string | null
          opportunity_sample_size?: number | null
          opportunity_score?: number | null
          opportunity_score_raw?: number | null
          opportunity_type?: string | null
          opportunity_type_since?: string | null
          opportunity_window?: string | null
          p75_directional_days?: number | null
          people_no_pct?: number | null
          people_yes_change_24h?: number | null
          people_yes_pct?: number | null
          positions_updated_at?: string | null
          pov_updated_at?: string | null
          read_model_version?: number
          rebuild_reason?: string | null
          sell_count_1h?: number
          sell_count_24h?: number
          sell_rate_24h?: number | null
          side_balance?: number | null
          side_flips_24h?: number
          trade_count_1h?: number
          trade_count_24h?: number
          trade_count_7d?: number
          trending_score?: number | null
          unique_wallets_1h?: number
          unique_wallets_24h?: number
          unique_wallets_7d?: number
          updated_at?: string
          velocity_5m?: number
          volume_24h_usd?: number | null
          volume_eth_1h?: number
          volume_eth_24h?: number
          volume_eth_7d?: number
          volume_total_usd?: number | null
          yes_capital_usd?: number | null
          yes_price_change_1h?: number | null
          yes_price_change_24h?: number | null
          yes_price_change_7d?: number | null
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
          category_source: string
          category_version: number
          created_at: string | null
          first_seen: string
          onchain_id: number
          our_metadata: Json | null
          pov_slug: string | null
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
          category_source?: string
          category_version?: number
          created_at?: string | null
          first_seen?: string
          onchain_id: number
          our_metadata?: Json | null
          pov_slug?: string | null
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
          category_source?: string
          category_version?: number
          created_at?: string | null
          first_seen?: string
          onchain_id?: number
          our_metadata?: Json | null
          pov_slug?: string | null
          pov_uuid?: string | null
          source?: string
          title?: string | null
        }
        Relationships: []
      }
      match_queue: {
        Row: {
          attempts: number
          done_at: string | null
          enqueued_at: string
          last_error: string | null
          pending: boolean
          started_at: string | null
          wallet: string
        }
        Insert: {
          attempts?: number
          done_at?: string | null
          enqueued_at?: string
          last_error?: string | null
          pending?: boolean
          started_at?: string | null
          wallet: string
        }
        Update: {
          attempts?: number
          done_at?: string | null
          enqueued_at?: string
          last_error?: string | null
          pending?: boolean
          started_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      price_snapshots: {
        Row: {
          captured_at: string
          money_yes_pct: number | null
          no_price_usd: number | null
          onchain_id: number
          yes_price_usd: number | null
        }
        Insert: {
          captured_at?: string
          money_yes_pct?: number | null
          no_price_usd?: number | null
          onchain_id: number
          yes_price_usd?: number | null
        }
        Update: {
          captured_at?: string
          money_yes_pct?: number | null
          no_price_usd?: number | null
          onchain_id?: number
          yes_price_usd?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          display_name: string | null
          fetched_at: string
          not_found: boolean
          pfp_url: string | null
          twitter_id: string | null
          username: string | null
          wallet: string
        }
        Insert: {
          display_name?: string | null
          fetched_at?: string
          not_found?: boolean
          pfp_url?: string | null
          twitter_id?: string | null
          username?: string | null
          wallet: string
        }
        Update: {
          display_name?: string | null
          fetched_at?: string
          not_found?: boolean
          pfp_url?: string | null
          twitter_id?: string | null
          username?: string | null
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
      viewer_dna_cache: {
        Row: {
          calculated_at: string
          candidate_count: number
          closest_matches: Json
          domain_matches: Json
          engine_version: number
          expires_at: string
          inverse_matches: Json
          last_error: string | null
          neutral_matches: Json
          opp_matches: Json
          scored_count: number
          tribe_matches: Json
          twin_matches: Json
          viewer_dna_version: number
          viewer_wallet: string
        }
        Insert: {
          calculated_at?: string
          candidate_count?: number
          closest_matches?: Json
          domain_matches?: Json
          engine_version?: number
          expires_at?: string
          inverse_matches?: Json
          last_error?: string | null
          neutral_matches?: Json
          opp_matches?: Json
          scored_count?: number
          tribe_matches?: Json
          twin_matches?: Json
          viewer_dna_version?: number
          viewer_wallet: string
        }
        Update: {
          calculated_at?: string
          candidate_count?: number
          closest_matches?: Json
          domain_matches?: Json
          engine_version?: number
          expires_at?: string
          inverse_matches?: Json
          last_error?: string | null
          neutral_matches?: Json
          opp_matches?: Json
          scored_count?: number
          tribe_matches?: Json
          twin_matches?: Json
          viewer_dna_version?: number
          viewer_wallet?: string
        }
        Relationships: []
      }
      wallet_beliefs: {
        Row: {
          applied_trade_count: number
          conviction: number
          days_held: number
          directional_since: string | null
          expressed_side: string
          first_backed_at: string | null
          last_applied_block_number: number | null
          last_applied_event_id: string | null
          last_applied_log_index: number | null
          last_applied_source_key: string | null
          last_evaluated_at: string | null
          last_trade_at: string | null
          needs_rebuild: boolean
          no_cost: number
          no_shares: number
          no_value_usd: number | null
          onchain_id: number
          position_version: number
          rebuild_reason: string | null
          rebuild_requested_at: string | null
          rebuilt_at: string | null
          stance: number | null
          stance_side: string | null
          state_hash: string | null
          updated_at: string
          value_source: string | null
          value_updated_at: string | null
          wallet: string
          yes_cost: number
          yes_shares: number
          yes_value_usd: number | null
        }
        Insert: {
          applied_trade_count?: number
          conviction?: number
          days_held?: number
          directional_since?: string | null
          expressed_side?: string
          first_backed_at?: string | null
          last_applied_block_number?: number | null
          last_applied_event_id?: string | null
          last_applied_log_index?: number | null
          last_applied_source_key?: string | null
          last_evaluated_at?: string | null
          last_trade_at?: string | null
          needs_rebuild?: boolean
          no_cost?: number
          no_shares?: number
          no_value_usd?: number | null
          onchain_id: number
          position_version?: number
          rebuild_reason?: string | null
          rebuild_requested_at?: string | null
          rebuilt_at?: string | null
          stance?: number | null
          stance_side?: string | null
          state_hash?: string | null
          updated_at?: string
          value_source?: string | null
          value_updated_at?: string | null
          wallet: string
          yes_cost?: number
          yes_shares?: number
          yes_value_usd?: number | null
        }
        Update: {
          applied_trade_count?: number
          conviction?: number
          days_held?: number
          directional_since?: string | null
          expressed_side?: string
          first_backed_at?: string | null
          last_applied_block_number?: number | null
          last_applied_event_id?: string | null
          last_applied_log_index?: number | null
          last_applied_source_key?: string | null
          last_evaluated_at?: string | null
          last_trade_at?: string | null
          needs_rebuild?: boolean
          no_cost?: number
          no_shares?: number
          no_value_usd?: number | null
          onchain_id?: number
          position_version?: number
          rebuild_reason?: string | null
          rebuild_requested_at?: string | null
          rebuilt_at?: string | null
          stance?: number | null
          stance_side?: string | null
          state_hash?: string | null
          updated_at?: string
          value_source?: string | null
          value_updated_at?: string | null
          wallet?: string
          yes_cost?: number
          yes_shares?: number
          yes_value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_beliefs_last_event_fk"
            columns: ["last_applied_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
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
      wallet_links: {
        Row: {
          connected_wallet: string
          created_at: string
          id: string
          linked_wallet: string
          signature: string | null
          verified_at: string | null
        }
        Insert: {
          connected_wallet: string
          created_at?: string
          id?: string
          linked_wallet: string
          signature?: string | null
          verified_at?: string | null
        }
        Update: {
          connected_wallet?: string
          created_at?: string
          id?: string
          linked_wallet?: string
          signature?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      wallet_match_version: {
        Row: {
          updated_at: string
          version: number
          wallet: string
        }
        Insert: {
          updated_at?: string
          version?: number
          wallet: string
        }
        Update: {
          updated_at?: string
          version?: number
          wallet?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_position_events: {
        Args: {
          p_applied_count: number
          p_cursor: Json
          p_expected_version: number
          p_market: number
          p_state: Json
          p_state_hash: string
          p_wallet: string
        }
        Returns: Json
      }
      claim_market_refresh: {
        Args: { p_limit: number }
        Returns: {
          activity_dirty: boolean
          market_id: number
          positions_dirty: boolean
          pov_dirty: boolean
          requested_at: string
        }[]
      }
      enqueue_market_refresh: {
        Args: { p_kind: string; p_market_ids: number[] }
        Returns: number
      }
      eth_usd_calibration: { Args: never; Returns: number }
      events_health: { Args: never; Returns: Json }
      find_match_candidates: {
        Args: {
          p_max_candidates?: number
          p_min_shared?: number
          p_viewer: string
        }
        Returns: {
          last_shared_activity_at: string
          opposite_side: number
          same_side: number
          shared_markets: number
          wallet: string
          weighted_evidence: number
        }[]
      }
      ingest_chain_chunk: {
        Args: {
          p_chain_id: number
          p_end: number
          p_events: Json
          p_present_keys: Json
          p_start: number
        }
        Returns: Json
      }
      mark_positions_dirty: {
        Args: { p_pairs: Json; p_reason: string }
        Returns: number
      }
      market_change_window: {
        Args: { p_ids: number[]; p_since: string }
        Returns: {
          chg_no: number
          chg_yes: number
          onchain_id: number
          since_at: string
        }[]
      }
      market_event_windows: {
        Args: { p_market: number; p_now: string }
        Returns: Json
      }
      market_position_aggregates: {
        Args: { p_market: number; p_now: string }
        Returns: Json
      }
      market_transition_windows: {
        Args: { p_market: number; p_now: string }
        Returns: Json
      }
      market_volume_window: {
        Args: { p_ids: number[]; p_since: string }
        Returns: {
          eth: number
          onchain_id: number
          side: string
          trade_count: number
        }[]
      }
      price_series_daily: {
        Args: { p_days: number; p_ids: number[] }
        Returns: {
          bucket: string
          onchain_id: number
          pct: number
        }[]
      }
      rebuild_position: {
        Args: {
          p_applied_count: number
          p_cursor: Json
          p_empty: boolean
          p_market: number
          p_state: Json
          p_state_hash: string
          p_wallet: string
        }
        Returns: Json
      }
      recompute_price_changes: { Args: never; Returns: undefined }
      request_viewer_match_refresh: {
        Args: { p_wallet: string }
        Returns: undefined
      }
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
