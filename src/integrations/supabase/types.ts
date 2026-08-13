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
      calc_cache: {
        Row: {
          key: string
          updated_at: string
          value: number | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      challenges: {
        Row: {
          challenger_wallet: string
          close_reason: string | null
          closed_at: string | null
          created_at: string
          id: number
          market_id: number
          mode: string
          parent_call: number | null
          slot_no: number
        }
        Insert: {
          challenger_wallet: string
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          id?: number
          market_id: number
          mode?: string
          parent_call?: number | null
          slot_no: number
        }
        Update: {
          challenger_wallet?: string
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          id?: number
          market_id?: number
          mode?: string
          parent_call?: number | null
          slot_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenges_parent_call_fkey"
            columns: ["parent_call"]
            isOneToOne: false
            referencedRelation: "market_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      conviction_markets: {
        Row: {
          category: string
          category_source: string
          chain_id: number
          contract_address: string
          created_at: string
          creator_fee_bps: number | null
          creator_wallet: string
          curve_address: string | null
          description: string | null
          format: string
          hidden: boolean
          last_error: string | null
          media: Json | null
          moderation_status: string
          no_agent: string | null
          no_token: string | null
          onchain_id: number | null
          pov_boost: boolean
          pov_boost_spend_degen: string | null
          question: string
          question_id: string
          seed_eth_wei: string | null
          side: string
          stake_amount_usd: number | null
          status: string
          transaction_hash: string | null
          updated_at: string
          usd_per_eth_at_creation: number | null
          yes_agent: string | null
          yes_token: string | null
        }
        Insert: {
          category?: string
          category_source?: string
          chain_id?: number
          contract_address: string
          created_at?: string
          creator_fee_bps?: number | null
          creator_wallet: string
          curve_address?: string | null
          description?: string | null
          format?: string
          hidden?: boolean
          last_error?: string | null
          media?: Json | null
          moderation_status?: string
          no_agent?: string | null
          no_token?: string | null
          onchain_id?: number | null
          pov_boost?: boolean
          pov_boost_spend_degen?: string | null
          question: string
          question_id: string
          seed_eth_wei?: string | null
          side?: string
          stake_amount_usd?: number | null
          status?: string
          transaction_hash?: string | null
          updated_at?: string
          usd_per_eth_at_creation?: number | null
          yes_agent?: string | null
          yes_token?: string | null
        }
        Update: {
          category?: string
          category_source?: string
          chain_id?: number
          contract_address?: string
          created_at?: string
          creator_fee_bps?: number | null
          creator_wallet?: string
          curve_address?: string | null
          description?: string | null
          format?: string
          hidden?: boolean
          last_error?: string | null
          media?: Json | null
          moderation_status?: string
          no_agent?: string | null
          no_token?: string | null
          onchain_id?: number | null
          pov_boost?: boolean
          pov_boost_spend_degen?: string | null
          question?: string
          question_id?: string
          seed_eth_wei?: string | null
          side?: string
          stake_amount_usd?: number | null
          status?: string
          transaction_hash?: string | null
          updated_at?: string
          usd_per_eth_at_creation?: number | null
          yes_agent?: string | null
          yes_token?: string | null
        }
        Relationships: []
      }
      conviction_trades: {
        Row: {
          action: string | null
          chain_id: number | null
          market_id: string | null
          recorded_at: string
          side: string | null
          tx_hash: string
          wallet: string
        }
        Insert: {
          action?: string | null
          chain_id?: number | null
          market_id?: string | null
          recorded_at?: string
          side?: string | null
          tx_hash: string
          wallet: string
        }
        Update: {
          action?: string | null
          chain_id?: number | null
          market_id?: string | null
          recorded_at?: string
          side?: string | null
          tx_hash?: string
          wallet?: string
        }
        Relationships: []
      }
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
      expressed_beliefs: {
        Row: {
          onchain_id: number
          side: string
          source: string
          updated_at: string
          wallet: string
          weight: number
        }
        Insert: {
          onchain_id: number
          side: string
          source?: string
          updated_at?: string
          wallet: string
          weight?: number
        }
        Update: {
          onchain_id?: number
          side?: string
          source?: string
          updated_at?: string
          wallet?: string
          weight?: number
        }
        Relationships: []
      }
      feed_snapshot: {
        Row: {
          key: string
          payload: Json
          updated_at: string
        }
        Insert: {
          key: string
          payload: Json
          updated_at?: string
        }
        Update: {
          key?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followed: string
          follower: string
        }
        Insert: {
          created_at?: string
          followed: string
          follower: string
        }
        Update: {
          created_at?: string
          followed?: string
          follower?: string
        }
        Relationships: []
      }
      forge_checks: {
        Row: {
          command: string | null
          completed_at: string | null
          duration_ms: number | null
          failure_summary: string | null
          id: string
          job_id: string
          name: string
          output_summary: string | null
          position: number
          started_at: string | null
          status: string
        }
        Insert: {
          command?: string | null
          completed_at?: string | null
          duration_ms?: number | null
          failure_summary?: string | null
          id?: string
          job_id: string
          name: string
          output_summary?: string | null
          position?: number
          started_at?: string | null
          status?: string
        }
        Update: {
          command?: string | null
          completed_at?: string | null
          duration_ms?: number | null
          failure_summary?: string | null
          id?: string
          job_id?: string
          name?: string
          output_summary?: string | null
          position?: number
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "forge_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "forge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      forge_discovery: {
        Row: {
          created_at: string
          created_by: string
          digest: Json
          id: string
          job_id: string | null
          messages: Json
          mode: string
          plan: Json
          ready: boolean
          request: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          digest?: Json
          id?: string
          job_id?: string | null
          messages?: Json
          mode?: string
          plan?: Json
          ready?: boolean
          request: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          digest?: Json
          id?: string
          job_id?: string | null
          messages?: Json
          mode?: string
          plan?: Json
          ready?: boolean
          request?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forge_discovery_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "forge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      forge_events: {
        Row: {
          created_at: string
          detail: Json | null
          id: number
          job_id: string
          kind: string
          level: string
          message: string
          role: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          id?: number
          job_id: string
          kind: string
          level?: string
          message: string
          role?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json | null
          id?: number
          job_id?: string
          kind?: string
          level?: string
          message?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forge_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "forge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      forge_jobs: {
        Row: {
          branch_name: string | null
          builder_model: string
          challenger_model: string
          created_at: string
          created_by: string | null
          current_phase: string | null
          diff_summary: Json | null
          error: string | null
          escalation_model: string
          id: string
          input_tokens: number
          mode: string
          output_tokens: number
          plan: Json | null
          plan_locked_at: string | null
          pr_url: string | null
          request: string
          status: string
          total_cost_usd: number
          updated_at: string
          verification_profile: string | null
          worker_job_id: string | null
        }
        Insert: {
          branch_name?: string | null
          builder_model: string
          challenger_model: string
          created_at?: string
          created_by?: string | null
          current_phase?: string | null
          diff_summary?: Json | null
          error?: string | null
          escalation_model: string
          id?: string
          input_tokens?: number
          mode: string
          output_tokens?: number
          plan?: Json | null
          plan_locked_at?: string | null
          pr_url?: string | null
          request: string
          status?: string
          total_cost_usd?: number
          updated_at?: string
          verification_profile?: string | null
          worker_job_id?: string | null
        }
        Update: {
          branch_name?: string | null
          builder_model?: string
          challenger_model?: string
          created_at?: string
          created_by?: string | null
          current_phase?: string | null
          diff_summary?: Json | null
          error?: string | null
          escalation_model?: string
          id?: string
          input_tokens?: number
          mode?: string
          output_tokens?: number
          plan?: Json | null
          plan_locked_at?: string | null
          pr_url?: string | null
          request?: string
          status?: string
          total_cost_usd?: number
          updated_at?: string
          verification_profile?: string | null
          worker_job_id?: string | null
        }
        Relationships: []
      }
      forge_model_config: {
        Row: {
          model_id: string
          role: string
          updated_at: string
        }
        Insert: {
          model_id: string
          role: string
          updated_at?: string
        }
        Update: {
          model_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      forge_model_runs: {
        Row: {
          cost_usd: number
          created_at: string
          error: string | null
          id: string
          input_tokens: number
          job_id: string
          latency_ms: number | null
          model_id: string
          output_tokens: number
          phase: string | null
          provider: string
          role: string
          status: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number
          job_id: string
          latency_ms?: number | null
          model_id: string
          output_tokens?: number
          phase?: string | null
          provider?: string
          role: string
          status?: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number
          job_id?: string
          latency_ms?: number | null
          model_id?: string
          output_tokens?: number
          phase?: string | null
          provider?: string
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "forge_model_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "forge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      forge_objections: {
        Row: {
          body: string | null
          created_at: string
          id: string
          job_id: string
          resolution: string | null
          resolved_at: string | null
          round: number
          severity: string
          status: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          job_id: string
          resolution?: string | null
          resolved_at?: string | null
          round?: number
          severity: string
          status?: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          job_id?: string
          resolution?: string | null
          resolved_at?: string | null
          round?: number
          severity?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "forge_objections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "forge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      forge_queue: {
        Row: {
          body: string | null
          created_at: string
          id: string
          job_id: string | null
          kind: string
          priority: number
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          kind?: string
          priority?: number
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          kind?: string
          priority?: number
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forge_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "forge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      forge_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      house_foundation_answers: {
        Row: {
          action: string
          answered_at: string
          dimension_contributions: Json
          foundation_key: string
          mapping_version: number
          wallet: string
        }
        Insert: {
          action: string
          answered_at?: string
          dimension_contributions?: Json
          foundation_key: string
          mapping_version: number
          wallet: string
        }
        Update: {
          action?: string
          answered_at?: string
          dimension_contributions?: Json
          foundation_key?: string
          mapping_version?: number
          wallet?: string
        }
        Relationships: []
      }
      house_predictions: {
        Row: {
          actual_action: string | null
          actual_amount_wei: number | null
          actual_shares: number | null
          actual_side: string | null
          actual_tx_hash: string | null
          answer_source: string | null
          category: string | null
          confidence: number
          created_at: string
          engine_version: number
          finalized_via: string | null
          no_read_kind: string | null
          onchain_id: number
          outcome: string | null
          predicted_action: string | null
          reasons: Json
          revealed_at: string | null
          wallet: string
        }
        Insert: {
          actual_action?: string | null
          actual_amount_wei?: number | null
          actual_shares?: number | null
          actual_side?: string | null
          actual_tx_hash?: string | null
          answer_source?: string | null
          category?: string | null
          confidence?: number
          created_at?: string
          engine_version?: number
          finalized_via?: string | null
          no_read_kind?: string | null
          onchain_id: number
          outcome?: string | null
          predicted_action?: string | null
          reasons?: Json
          revealed_at?: string | null
          wallet: string
        }
        Update: {
          actual_action?: string | null
          actual_amount_wei?: number | null
          actual_shares?: number | null
          actual_side?: string | null
          actual_tx_hash?: string | null
          answer_source?: string | null
          category?: string | null
          confidence?: number
          created_at?: string
          engine_version?: number
          finalized_via?: string | null
          no_read_kind?: string | null
          onchain_id?: number
          outcome?: string | null
          predicted_action?: string | null
          reasons?: Json
          revealed_at?: string | null
          wallet?: string
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
      market_ai_analysis: {
        Row: {
          analyzed_at: string | null
          answerability_score: number | null
          attempts: number
          audience: string | null
          category: string | null
          clarity_score: number | null
          content_hash: string
          created_at: string
          debate_score: number | null
          duplicate_cluster_id: string | null
          duplicate_similarity: number | null
          embedding: Json | null
          engine_version: number
          identity_score: number | null
          last_error: string | null
          media_relevance: number | null
          novelty_score: number | null
          onchain_id: number
          quality_score: number | null
          related_topics: string[]
          risk_flags: string[]
          status: string
          subcategory: string | null
          summary: string | null
          time_sensitivity: number | null
          topic: string | null
          updated_at: string
        }
        Insert: {
          analyzed_at?: string | null
          answerability_score?: number | null
          attempts?: number
          audience?: string | null
          category?: string | null
          clarity_score?: number | null
          content_hash: string
          created_at?: string
          debate_score?: number | null
          duplicate_cluster_id?: string | null
          duplicate_similarity?: number | null
          embedding?: Json | null
          engine_version?: number
          identity_score?: number | null
          last_error?: string | null
          media_relevance?: number | null
          novelty_score?: number | null
          onchain_id: number
          quality_score?: number | null
          related_topics?: string[]
          risk_flags?: string[]
          status?: string
          subcategory?: string | null
          summary?: string | null
          time_sensitivity?: number | null
          topic?: string | null
          updated_at?: string
        }
        Update: {
          analyzed_at?: string | null
          answerability_score?: number | null
          attempts?: number
          audience?: string | null
          category?: string | null
          clarity_score?: number | null
          content_hash?: string
          created_at?: string
          debate_score?: number | null
          duplicate_cluster_id?: string | null
          duplicate_similarity?: number | null
          embedding?: Json | null
          engine_version?: number
          identity_score?: number | null
          last_error?: string | null
          media_relevance?: number | null
          novelty_score?: number | null
          onchain_id?: number
          quality_score?: number | null
          related_topics?: string[]
          risk_flags?: string[]
          status?: string
          subcategory?: string | null
          summary?: string | null
          time_sensitivity?: number | null
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      market_calls: {
        Row: {
          called_at: string
          caller_wallet: string
          challenge_id: number | null
          id: number
          market_id: number
          mode: string
          passed_at: string | null
          relation_at_call: string
          responded_at: string | null
          responded_side: string | null
          responder_wallet: string
        }
        Insert: {
          called_at?: string
          caller_wallet: string
          challenge_id?: number | null
          id?: number
          market_id: number
          mode?: string
          passed_at?: string | null
          relation_at_call: string
          responded_at?: string | null
          responded_side?: string | null
          responder_wallet: string
        }
        Update: {
          called_at?: string
          caller_wallet?: string
          challenge_id?: number | null
          id?: number
          market_id?: number
          mode?: string
          passed_at?: string | null
          relation_at_call?: string
          responded_at?: string | null
          responded_side?: string | null
          responder_wallet?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_calls_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      market_milestone: {
        Row: {
          market_id: string
          reached_at: string
          side: string
          threshold: number
        }
        Insert: {
          market_id: string
          reached_at?: string
          side: string
          threshold: number
        }
        Update: {
          market_id?: string
          reached_at?: string
          side?: string
          threshold?: number
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
      market_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          onchain_id: number | null
          question_id: string | null
          reason: string
          reporter_wallet: string | null
          resolution_note: string | null
          resolved: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          onchain_id?: number | null
          question_id?: string | null
          reason: string
          reporter_wallet?: string | null
          resolution_note?: string | null
          resolved?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          onchain_id?: number | null
          question_id?: string | null
          reason?: string
          reporter_wallet?: string | null
          resolution_note?: string | null
          resolved?: boolean
          updated_at?: string
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
          capital_usd: number | null
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
          new_believers_no_24h: number
          new_believers_yes_24h: number
          no_capital_delta_24h: number | null
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
          yes_capital_delta_24h: number | null
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
          capital_usd?: number | null
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
          new_believers_no_24h?: number
          new_believers_yes_24h?: number
          no_capital_delta_24h?: number | null
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
          yes_capital_delta_24h?: number | null
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
          capital_usd?: number | null
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
          new_believers_no_24h?: number
          new_believers_yes_24h?: number
          no_capital_delta_24h?: number | null
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
          yes_capital_delta_24h?: number | null
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
      market_state_snapshots: {
        Row: {
          believers_no: number | null
          believers_yes: number | null
          captured_at: string
          no_capital_usd: number | null
          no_price_usd: number | null
          onchain_id: number
          yes_capital_usd: number | null
          yes_price_usd: number | null
        }
        Insert: {
          believers_no?: number | null
          believers_yes?: number | null
          captured_at?: string
          no_capital_usd?: number | null
          no_price_usd?: number | null
          onchain_id: number
          yes_capital_usd?: number | null
          yes_price_usd?: number | null
        }
        Update: {
          believers_no?: number | null
          believers_yes?: number | null
          captured_at?: string
          no_capital_usd?: number | null
          no_price_usd?: number | null
          onchain_id?: number
          yes_capital_usd?: number | null
          yes_price_usd?: number | null
        }
        Relationships: []
      }
      market_suggestion_events: {
        Row: {
          id: number
          meta: Json
          suggestion_id: string | null
          ts: string
          type: string
          wallet: string | null
        }
        Insert: {
          id?: number
          meta?: Json
          suggestion_id?: string | null
          ts?: string
          type: string
          wallet?: string | null
        }
        Update: {
          id?: number
          meta?: Json
          suggestion_id?: string | null
          ts?: string
          type?: string
          wallet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_suggestion_events_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "market_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      market_suggestions: {
        Row: {
          category: string
          created_market_id: number | null
          engine_version: number
          expires_at: string
          final_question: string | null
          generated_at: string
          id: string
          question: string
          score: number | null
          secondary_category: string | null
          short_reason: string
          shown_at: string | null
          source_category: string
          status: string
          topics: string[]
          updated_at: string
          wallet: string
        }
        Insert: {
          category: string
          created_market_id?: number | null
          engine_version?: number
          expires_at?: string
          final_question?: string | null
          generated_at?: string
          id?: string
          question: string
          score?: number | null
          secondary_category?: string | null
          short_reason: string
          shown_at?: string | null
          source_category: string
          status?: string
          topics?: string[]
          updated_at?: string
          wallet: string
        }
        Update: {
          category?: string
          created_market_id?: number | null
          engine_version?: number
          expires_at?: string
          final_question?: string | null
          generated_at?: string
          id?: string
          question?: string
          score?: number | null
          secondary_category?: string | null
          short_reason?: string
          shown_at?: string | null
          source_category?: string
          status?: string
          topics?: string[]
          updated_at?: string
          wallet?: string
        }
        Relationships: []
      }
      market_transition_state: {
        Row: {
          fingerprint: string
          first_seen_at: string
          last_emitted_at: string | null
          last_seen_at: string
          onchain_id: number
          seen_count: number
          updated_at: string
        }
        Insert: {
          fingerprint: string
          first_seen_at?: string
          last_emitted_at?: string | null
          last_seen_at?: string
          onchain_id: number
          seen_count?: number
          updated_at?: string
        }
        Update: {
          fingerprint?: string
          first_seen_at?: string
          last_emitted_at?: string | null
          last_seen_at?: string
          onchain_id?: number
          seen_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      market_window_change: {
        Row: {
          chg_no: number | null
          chg_yes: number | null
          onchain_id: number
          since_at: string | null
          updated_at: string
          window_key: string
        }
        Insert: {
          chg_no?: number | null
          chg_yes?: number | null
          onchain_id: number
          since_at?: string | null
          updated_at?: string
          window_key: string
        }
        Update: {
          chg_no?: number | null
          chg_yes?: number | null
          onchain_id?: number
          since_at?: string | null
          updated_at?: string
          window_key?: string
        }
        Relationships: []
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
      price_path_hourly: {
        Row: {
          captured_at: string
          hour_start: string
          onchain_id: number
          yes_price_usd: number
        }
        Insert: {
          captured_at: string
          hour_start: string
          onchain_id: number
          yes_price_usd: number
        }
        Update: {
          captured_at?: string
          hour_start?: string
          onchain_id?: number
          yes_price_usd?: number
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
      profile_overrides: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          updated_at: string
          wallet: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          updated_at?: string
          wallet: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          updated_at?: string
          wallet?: string
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
      share_codes: {
        Row: {
          code: string
          created_at: string
          wallet: string
        }
        Insert: {
          code: string
          created_at?: string
          wallet: string
        }
        Update: {
          code?: string
          created_at?: string
          wallet?: string
        }
        Relationships: []
      }
      share_visits: {
        Row: {
          connected_at: string | null
          id: number
          market_id: number | null
          opened_at: string
          ref_code: string
          visitor_id: string
          wallet: string | null
        }
        Insert: {
          connected_at?: string | null
          id?: number
          market_id?: number | null
          opened_at?: string
          ref_code: string
          visitor_id: string
          wallet?: string | null
        }
        Update: {
          connected_at?: string | null
          id?: number
          market_id?: number | null
          opened_at?: string
          ref_code?: string
          visitor_id?: string
          wallet?: string | null
        }
        Relationships: []
      }
      simulation_accounts: {
        Row: {
          activated_at: string
          available_balance_cc: number
          created_at: string
          exited_at: string | null
          graduated_at: string | null
          starting_balance_cc: number
          state: string
          updated_at: string
          wallet: string
        }
        Insert: {
          activated_at?: string
          available_balance_cc?: number
          created_at?: string
          exited_at?: string | null
          graduated_at?: string | null
          starting_balance_cc?: number
          state?: string
          updated_at?: string
          wallet: string
        }
        Update: {
          activated_at?: string
          available_balance_cc?: number
          created_at?: string
          exited_at?: string | null
          graduated_at?: string | null
          starting_balance_cc?: number
          state?: string
          updated_at?: string
          wallet?: string
        }
        Relationships: []
      }
      simulation_house_rounds: {
        Row: {
          actual_action: string | null
          created_at: string
          finalized_via: string | null
          onchain_id: number
          revealed_at: string | null
          simulation_order_id: number | null
          wallet: string
        }
        Insert: {
          actual_action?: string | null
          created_at?: string
          finalized_via?: string | null
          onchain_id: number
          revealed_at?: string | null
          simulation_order_id?: number | null
          wallet: string
        }
        Update: {
          actual_action?: string | null
          created_at?: string
          finalized_via?: string | null
          onchain_id?: number
          revealed_at?: string | null
          simulation_order_id?: number | null
          wallet?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_house_rounds_simulation_order_id_fkey"
            columns: ["simulation_order_id"]
            isOneToOne: false
            referencedRelation: "simulation_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_orders: {
        Row: {
          action: string
          amount_cc: number
          created_at: string
          id: number
          idempotency_key: string
          market_price_usd: number | null
          onchain_id: number
          request_fingerprint: string
          share_delta: number
          side: string
          simulated_fee_cc: number
          status: string
          wallet: string
        }
        Insert: {
          action: string
          amount_cc: number
          created_at?: string
          id?: number
          idempotency_key: string
          market_price_usd?: number | null
          onchain_id: number
          request_fingerprint?: string
          share_delta: number
          side: string
          simulated_fee_cc?: number
          status?: string
          wallet: string
        }
        Update: {
          action?: string
          amount_cc?: number
          created_at?: string
          id?: number
          idempotency_key?: string
          market_price_usd?: number | null
          onchain_id?: number
          request_fingerprint?: string
          share_delta?: number
          side?: string
          simulated_fee_cc?: number
          status?: string
          wallet?: string
        }
        Relationships: []
      }
      simulation_positions: {
        Row: {
          last_directional_side: string | null
          no_cost_cc: number
          no_shares: number
          onchain_id: number
          opened_at: string
          updated_at: string
          wallet: string
          yes_cost_cc: number
          yes_shares: number
        }
        Insert: {
          last_directional_side?: string | null
          no_cost_cc?: number
          no_shares?: number
          onchain_id: number
          opened_at?: string
          updated_at?: string
          wallet: string
          yes_cost_cc?: number
          yes_shares?: number
        }
        Update: {
          last_directional_side?: string | null
          no_cost_cc?: number
          no_shares?: number
          onchain_id?: number
          opened_at?: string
          updated_at?: string
          wallet?: string
          yes_cost_cc?: number
          yes_shares?: number
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
      viewer_market_decisions: {
        Row: {
          decided_at: string
          decision: string
          market_id: number
          viewer_wallet: string
        }
        Insert: {
          decided_at?: string
          decision: string
          market_id: number
          viewer_wallet: string
        }
        Update: {
          decided_at?: string
          decision?: string
          market_id?: number
          viewer_wallet?: string
        }
        Relationships: []
      }
      viewer_market_events: {
        Row: {
          count: number
          kind: string
          last_at: string
          market_id: number
          viewer_wallet: string
        }
        Insert: {
          count?: number
          kind: string
          last_at?: string
          market_id: number
          viewer_wallet: string
        }
        Update: {
          count?: number
          kind?: string
          last_at?: string
          market_id?: number
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
          last_directional_side: string | null
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
          last_directional_side?: string | null
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
          last_directional_side?: string | null
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
      conviction_attributed_value: {
        Args: { p_growth_days?: number }
        Returns: Json
      }
      conviction_ecosystem_share: { Args: { p_days?: number }; Returns: Json }
      detect_believer_milestones: { Args: never; Returns: number }
      detect_tribe_doublings: { Args: never; Returns: number }
      enqueue_market_refresh: {
        Args: { p_kind: string; p_market_ids: number[] }
        Returns: number
      }
      enqueue_stale_markets: {
        Args: { p_active_days?: number; p_limit?: number }
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
      latest_trade_activity: {
        Args: { p_wallets: string[] }
        Returns: {
          action: string
          market_id: string
          occurred_at: string
          side: string
          wallet: string
        }[]
      }
      latest_trades_per_market: {
        Args: { p_ids: string[]; p_per: number }
        Returns: {
          action: string
          amount_eth: number
          block_number: number
          chain_id: number
          kind: string
          log_index: number
          market_id: string
          occurred_at: string
          price: number
          shares: number
          side: string
          source: string
          source_key: string
          wallet: string
        }[]
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
      market_participation: {
        Args: never
        Returns: {
          first_activity_at: string
          last_activity_at: string
          onchain_id: number
          participants: number
        }[]
      }
      market_position_aggregates: {
        Args: { p_market: number; p_now: string }
        Returns: Json
      }
      market_price_path: {
        Args: { p_hours?: number; p_ids: number[] }
        Returns: {
          captured_at: string
          onchain_id: number
          yes_price_usd: number
        }[]
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
      market_window_baselines: {
        Args: { p_id: number }
        Returns: {
          believers_no: number
          believers_yes: number
          no_capital_usd: number
          no_price_usd: number
          window_key: string
          yes_capital_usd: number
          yes_price_usd: number
        }[]
      }
      market_window_baselines_bulk: {
        Args: { p_ids: number[]; p_window: string }
        Returns: {
          believers_no: number
          believers_yes: number
          captured_at: string
          no_capital_usd: number
          no_price_usd: number
          onchain_id: number
          yes_capital_usd: number
          yes_price_usd: number
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
      put_on_table:
        | {
            Args: {
              p_audience: Json
              p_challenger: string
              p_market_id: number
              p_parent_call: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_audience: Json
              p_challenger: string
              p_market_id: number
              p_mode: string
              p_parent_call: number
            }
            Returns: Json
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
      record_viewer_market_event: {
        Args: { p_kind: string; p_market: number; p_wallet: string }
        Returns: undefined
      }
      refresh_eth_usd_calibration: { Args: never; Returns: number }
      refresh_market_window_change: {
        Args: { p_window?: string }
        Returns: number
      }
      refresh_price_path_hourly: { Args: { p_hours?: number }; Returns: number }
      request_viewer_match_refresh: {
        Args: { p_wallet: string }
        Returns: undefined
      }
      simulation_activate: {
        Args: { p_start: number; p_target: number; p_wallet: string }
        Returns: Json
      }
      simulation_conviction_count: {
        Args: { p_wallet: string }
        Returns: number
      }
      simulation_execute_order: {
        Args: {
          p_action: string
          p_amount_cc: number
          p_fee_cc: number
          p_fingerprint?: string
          p_idempotency_key: string
          p_market_id: number
          p_price_usd: number
          p_share_delta: number
          p_side: string
          p_target: number
          p_wallet: string
          p_weight: number
        }
        Returns: Json
      }
      simulation_exit: { Args: { p_wallet: string }; Returns: Json }
      simulation_graduate: {
        Args: { p_target: number; p_wallet: string }
        Returns: Json
      }
      simulation_release_challenges: {
        Args: { p_me: string }
        Returns: undefined
      }
      simulation_replay_order: {
        Args: {
          p_fingerprint: string
          p_idempotency_key: string
          p_wallet: string
        }
        Returns: Json
      }
      snapshot_market_state: { Args: never; Returns: number }
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
