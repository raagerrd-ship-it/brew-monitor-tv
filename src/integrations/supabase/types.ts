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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      auto_cooling_adjustments: {
        Row: {
          cooler_controller_id: string
          cooler_controller_name: string
          created_at: string
          followed_controller_id: string | null
          followed_controller_name: string | null
          followed_current_temp: number | null
          followed_hysteresis: number | null
          followed_target_temp: number | null
          id: string
          lowest_followed_temp: number
          new_target_temp: number
          old_target_temp: number
          reason: string
        }
        Insert: {
          cooler_controller_id: string
          cooler_controller_name: string
          created_at?: string
          followed_controller_id?: string | null
          followed_controller_name?: string | null
          followed_current_temp?: number | null
          followed_hysteresis?: number | null
          followed_target_temp?: number | null
          id?: string
          lowest_followed_temp: number
          new_target_temp: number
          old_target_temp: number
          reason: string
        }
        Update: {
          cooler_controller_id?: string
          cooler_controller_name?: string
          created_at?: string
          followed_controller_id?: string | null
          followed_controller_name?: string | null
          followed_current_temp?: number | null
          followed_hysteresis?: number | null
          followed_target_temp?: number | null
          id?: string
          lowest_followed_temp?: number
          new_target_temp?: number
          old_target_temp?: number
          reason?: string
        }
        Relationships: []
      }
      auto_cooling_decision_logs: {
        Row: {
          adjustment_made: boolean
          created_at: string
          decision_count: number
          decisions: Json
          duration_ms: number
          final_result: string
          id: string
        }
        Insert: {
          adjustment_made?: boolean
          created_at?: string
          decision_count: number
          decisions?: Json
          duration_ms: number
          final_result: string
          id?: string
        }
        Update: {
          adjustment_made?: boolean
          created_at?: string
          decision_count?: number
          decisions?: Json
          duration_ms?: number
          final_result?: string
          id?: string
        }
        Relationships: []
      }
      auto_cooling_followed_controllers: {
        Row: {
          controller_id: string
          created_at: string | null
          id: string
        }
        Insert: {
          controller_id: string
          created_at?: string | null
          id?: string
        }
        Update: {
          controller_id?: string
          created_at?: string | null
          id?: string
        }
        Relationships: []
      }
      auto_cooling_settings: {
        Row: {
          check_interval_minutes: number
          cooler_controller_id: string | null
          created_at: string
          enabled: boolean
          id: string
          last_check_at: string | null
          max_diff_from_lowest: number
          temp_reduction_degrees: number
          updated_at: string
        }
        Insert: {
          check_interval_minutes?: number
          cooler_controller_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_check_at?: string | null
          max_diff_from_lowest?: number
          temp_reduction_degrees?: number
          updated_at?: string
        }
        Update: {
          check_interval_minutes?: number
          cooler_controller_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_check_at?: string | null
          max_diff_from_lowest?: number
          temp_reduction_degrees?: number
          updated_at?: string
        }
        Relationships: []
      }
      brew_events: {
        Row: {
          brew_id: string
          created_at: string
          event_date: string
          event_type: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          brew_id: string
          created_at?: string
          event_date: string
          event_type: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          brew_id?: string
          created_at?: string
          event_date?: string
          event_type?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brew_events_brew_id_fkey"
            columns: ["brew_id"]
            isOneToOne: false
            referencedRelation: "brew_readings"
            referencedColumns: ["id"]
          },
        ]
      }
      brew_readings: {
        Row: {
          abv: number
          attenuation: number
          batch_id: string
          batch_number: string
          battery: number | null
          coldcrash_acknowledged: boolean
          created_at: string
          current_sg: number
          current_temp: number
          description: string | null
          fermentation_start: string | null
          final_gravity: number
          id: string
          label_image_url: string | null
          last_update: string | null
          linked_controller_id: string | null
          linked_pill_id: string | null
          name: string
          original_gravity: number
          sg_data: Json
          share_id: string | null
          status: string
          style: string
          updated_at: string
        }
        Insert: {
          abv: number
          attenuation: number
          batch_id: string
          batch_number: string
          battery?: number | null
          coldcrash_acknowledged?: boolean
          created_at?: string
          current_sg: number
          current_temp: number
          description?: string | null
          fermentation_start?: string | null
          final_gravity: number
          id?: string
          label_image_url?: string | null
          last_update?: string | null
          linked_controller_id?: string | null
          linked_pill_id?: string | null
          name: string
          original_gravity: number
          sg_data?: Json
          share_id?: string | null
          status: string
          style: string
          updated_at?: string
        }
        Update: {
          abv?: number
          attenuation?: number
          batch_id?: string
          batch_number?: string
          battery?: number | null
          coldcrash_acknowledged?: boolean
          created_at?: string
          current_sg?: number
          current_temp?: number
          description?: string | null
          fermentation_start?: string | null
          final_gravity?: number
          id?: string
          label_image_url?: string | null
          last_update?: string | null
          linked_controller_id?: string | null
          linked_pill_id?: string | null
          name?: string
          original_gravity?: number
          sg_data?: Json
          share_id?: string | null
          status?: string
          style?: string
          updated_at?: string
        }
        Relationships: []
      }
      cached_external_timer: {
        Row: {
          beer_style: string | null
          created_at: string
          external_user_id: string
          id: string
          is_active: boolean
          is_paused: boolean
          label: string | null
          last_synced_at: string
          milestones: Json
          next_config: Json | null
          next_milestone: Json | null
          paused_at: string | null
          paused_by_milestone: boolean
          progress: number
          recipe_name: string | null
          remaining_seconds: number
          time_to_next_milestone: number | null
          total_seconds: number
          updated_at: string
          wizard_started_at: string | null
          wizard_step: string | null
        }
        Insert: {
          beer_style?: string | null
          created_at?: string
          external_user_id: string
          id?: string
          is_active?: boolean
          is_paused?: boolean
          label?: string | null
          last_synced_at?: string
          milestones?: Json
          next_config?: Json | null
          next_milestone?: Json | null
          paused_at?: string | null
          paused_by_milestone?: boolean
          progress?: number
          recipe_name?: string | null
          remaining_seconds?: number
          time_to_next_milestone?: number | null
          total_seconds?: number
          updated_at?: string
          wizard_started_at?: string | null
          wizard_step?: string | null
        }
        Update: {
          beer_style?: string | null
          created_at?: string
          external_user_id?: string
          id?: string
          is_active?: boolean
          is_paused?: boolean
          label?: string | null
          last_synced_at?: string
          milestones?: Json
          next_config?: Json | null
          next_milestone?: Json | null
          paused_at?: string | null
          paused_by_milestone?: boolean
          progress?: number
          recipe_name?: string | null
          remaining_seconds?: number
          time_to_next_milestone?: number | null
          total_seconds?: number
          updated_at?: string
          wizard_started_at?: string | null
          wizard_step?: string | null
        }
        Relationships: []
      }
      external_user_settings: {
        Row: {
          created_at: string
          external_user_id: string
          id: string
          timer_tv_mode_only: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_user_id: string
          id?: string
          timer_tv_mode_only?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_user_id?: string
          id?: string
          timer_tv_mode_only?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      fermentation_profile_steps: {
        Row: {
          created_at: string
          duration_hours: number | null
          gravity_stable_days: number | null
          gravity_threshold: number | null
          id: string
          notes: string | null
          profile_id: string
          ramp_type: string | null
          sg_comparison: string | null
          step_order: number
          step_type: string
          target_sg: number | null
          target_temp: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_hours?: number | null
          gravity_stable_days?: number | null
          gravity_threshold?: number | null
          id?: string
          notes?: string | null
          profile_id: string
          ramp_type?: string | null
          sg_comparison?: string | null
          step_order: number
          step_type: string
          target_sg?: number | null
          target_temp?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_hours?: number | null
          gravity_stable_days?: number | null
          gravity_threshold?: number | null
          id?: string
          notes?: string | null
          profile_id?: string
          ramp_type?: string | null
          sg_comparison?: string | null
          step_order?: number
          step_type?: string
          target_sg?: number | null
          target_temp?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fermentation_profile_steps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "fermentation_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fermentation_profiles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      fermentation_sessions: {
        Row: {
          brew_id: string | null
          completed_at: string | null
          controller_id: string
          created_at: string
          current_step_index: number
          id: string
          profile_id: string
          started_at: string
          status: string
          step_start_temp: number | null
          step_started_at: string
          updated_at: string
        }
        Insert: {
          brew_id?: string | null
          completed_at?: string | null
          controller_id: string
          created_at?: string
          current_step_index?: number
          id?: string
          profile_id: string
          started_at?: string
          status?: string
          step_start_temp?: number | null
          step_started_at?: string
          updated_at?: string
        }
        Update: {
          brew_id?: string | null
          completed_at?: string | null
          controller_id?: string
          created_at?: string
          current_step_index?: number
          id?: string
          profile_id?: string
          started_at?: string
          status?: string
          step_start_temp?: number | null
          step_started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fermentation_sessions_brew_id_fkey"
            columns: ["brew_id"]
            isOneToOne: false
            referencedRelation: "brew_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fermentation_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "fermentation_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fermentation_step_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          session_id: string
          step_index: number
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          session_id: string
          step_index: number
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          session_id?: string
          step_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "fermentation_step_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fermentation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rapt_pills: {
        Row: {
          battery_level: number
          color: string
          created_at: string
          id: string
          last_update: string | null
          name: string
          pill_id: string
          updated_at: string
        }
        Insert: {
          battery_level: number
          color: string
          created_at?: string
          id?: string
          last_update?: string | null
          name: string
          pill_id: string
          updated_at?: string
        }
        Update: {
          battery_level?: number
          color?: string
          created_at?: string
          id?: string
          last_update?: string | null
          name?: string
          pill_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rapt_temp_controllers: {
        Row: {
          controller_id: string
          cooling_enabled: boolean | null
          cooling_hysteresis: number | null
          cooling_run_time: number | null
          cooling_starts: number | null
          created_at: string
          current_temp: number | null
          heating_enabled: boolean | null
          heating_hysteresis: number | null
          heating_run_time: number | null
          heating_starts: number | null
          heating_utilisation: number | null
          id: string
          last_update: string | null
          linked_pill_id: string | null
          max_target_temp: number | null
          min_target_temp: number | null
          name: string
          pill_temp: number | null
          target_temp: number | null
          updated_at: string
        }
        Insert: {
          controller_id: string
          cooling_enabled?: boolean | null
          cooling_hysteresis?: number | null
          cooling_run_time?: number | null
          cooling_starts?: number | null
          created_at?: string
          current_temp?: number | null
          heating_enabled?: boolean | null
          heating_hysteresis?: number | null
          heating_run_time?: number | null
          heating_starts?: number | null
          heating_utilisation?: number | null
          id?: string
          last_update?: string | null
          linked_pill_id?: string | null
          max_target_temp?: number | null
          min_target_temp?: number | null
          name: string
          pill_temp?: number | null
          target_temp?: number | null
          updated_at?: string
        }
        Update: {
          controller_id?: string
          cooling_enabled?: boolean | null
          cooling_hysteresis?: number | null
          cooling_run_time?: number | null
          cooling_starts?: number | null
          created_at?: string
          current_temp?: number | null
          heating_enabled?: boolean | null
          heating_hysteresis?: number | null
          heating_run_time?: number | null
          heating_starts?: number | null
          heating_utilisation?: number | null
          id?: string
          last_update?: string | null
          linked_pill_id?: string | null
          max_target_temp?: number | null
          min_target_temp?: number | null
          name?: string
          pill_temp?: number | null
          target_temp?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      selected_brews: {
        Row: {
          batch_id: string
          created_at: string
          display_order: number
          id: string
          is_visible: boolean
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          display_order: number
          id?: string
          is_visible?: boolean
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      selected_rapt_pills: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_visible: boolean
          pill_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          pill_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          pill_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      selected_rapt_temp_controllers: {
        Row: {
          controller_id: string
          created_at: string
          display_order: number
          id: string
          is_visible: boolean
          updated_at: string
        }
        Insert: {
          controller_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          updated_at?: string
        }
        Update: {
          controller_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      sonos_now_playing: {
        Row: {
          album_art_url: string | null
          album_art_url_small: string | null
          album_name: string | null
          artist_name: string | null
          bg_image_url: string | null
          duration_ms: number | null
          group_id: string
          id: string
          next_album_art_url: string | null
          next_artist_name: string | null
          next_bg_image_url: string | null
          next_track_name: string | null
          next_widget_art_url: string | null
          playback_state: string
          position_ms: number | null
          track_name: string | null
          updated_at: string
          widget_art_url: string | null
        }
        Insert: {
          album_art_url?: string | null
          album_art_url_small?: string | null
          album_name?: string | null
          artist_name?: string | null
          bg_image_url?: string | null
          duration_ms?: number | null
          group_id: string
          id?: string
          next_album_art_url?: string | null
          next_artist_name?: string | null
          next_bg_image_url?: string | null
          next_track_name?: string | null
          next_widget_art_url?: string | null
          playback_state?: string
          position_ms?: number | null
          track_name?: string | null
          updated_at?: string
          widget_art_url?: string | null
        }
        Update: {
          album_art_url?: string | null
          album_art_url_small?: string | null
          album_name?: string | null
          artist_name?: string | null
          bg_image_url?: string | null
          duration_ms?: number | null
          group_id?: string
          id?: string
          next_album_art_url?: string | null
          next_artist_name?: string | null
          next_bg_image_url?: string | null
          next_track_name?: string | null
          next_widget_art_url?: string | null
          playback_state?: string
          position_ms?: number | null
          track_name?: string | null
          updated_at?: string
          widget_art_url?: string | null
        }
        Relationships: []
      }
      sonos_settings: {
        Row: {
          bg_blur: number
          bg_brightness: number
          bg_contrast: number
          bg_saturation: number
          bg_top_gradient_height: number
          bg_top_gradient_opacity: number
          created_at: string
          id: string
          prefetch_seconds: number
          selected_group_id: string | null
          selected_group_name: string | null
          show_on_dashboard: boolean
          spotify_client_id: string | null
          spotify_client_secret: string | null
          track_change_offset_seconds: number
          updated_at: string
        }
        Insert: {
          bg_blur?: number
          bg_brightness?: number
          bg_contrast?: number
          bg_saturation?: number
          bg_top_gradient_height?: number
          bg_top_gradient_opacity?: number
          created_at?: string
          id?: string
          prefetch_seconds?: number
          selected_group_id?: string | null
          selected_group_name?: string | null
          show_on_dashboard?: boolean
          spotify_client_id?: string | null
          spotify_client_secret?: string | null
          track_change_offset_seconds?: number
          updated_at?: string
        }
        Update: {
          bg_blur?: number
          bg_brightness?: number
          bg_contrast?: number
          bg_saturation?: number
          bg_top_gradient_height?: number
          bg_top_gradient_opacity?: number
          created_at?: string
          id?: string
          prefetch_seconds?: number
          selected_group_id?: string | null
          selected_group_name?: string | null
          show_on_dashboard?: boolean
          spotify_client_id?: string | null
          spotify_client_secret?: string | null
          track_change_offset_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      sonos_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          household_id: string | null
          id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          household_id?: string | null
          id?: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          household_id?: string | null
          id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_settings: {
        Row: {
          auto_activate_fermenting: boolean | null
          auto_hide_archived: boolean | null
          auto_hide_completed: boolean | null
          auto_hide_conditioning: boolean | null
          created_at: string
          force_tv_refresh_at: string | null
          full_sync_interval: number | null
          id: string
          last_full_sync_at: string | null
          last_rapt_quick_sync_at: string | null
          last_rapt_sync_at: string | null
          last_sync_at: string | null
          last_sync_time: string | null
          rapt_sync_interval: number
          show_fps_counter: boolean
          sync_interval: number
          updated_at: string
        }
        Insert: {
          auto_activate_fermenting?: boolean | null
          auto_hide_archived?: boolean | null
          auto_hide_completed?: boolean | null
          auto_hide_conditioning?: boolean | null
          created_at?: string
          force_tv_refresh_at?: string | null
          full_sync_interval?: number | null
          id?: string
          last_full_sync_at?: string | null
          last_rapt_quick_sync_at?: string | null
          last_rapt_sync_at?: string | null
          last_sync_at?: string | null
          last_sync_time?: string | null
          rapt_sync_interval?: number
          show_fps_counter?: boolean
          sync_interval?: number
          updated_at?: string
        }
        Update: {
          auto_activate_fermenting?: boolean | null
          auto_hide_archived?: boolean | null
          auto_hide_completed?: boolean | null
          auto_hide_conditioning?: boolean | null
          created_at?: string
          force_tv_refresh_at?: string | null
          full_sync_interval?: number | null
          id?: string
          last_full_sync_at?: string | null
          last_rapt_quick_sync_at?: string | null
          last_rapt_sync_at?: string | null
          last_sync_at?: string | null
          last_sync_time?: string | null
          rapt_sync_interval?: number
          show_fps_counter?: boolean
          sync_interval?: number
          updated_at?: string
        }
        Relationships: []
      }
      temp_controller_history: {
        Row: {
          controller_id: string
          cooling_enabled: boolean
          created_at: string
          current_temp: number
          id: string
          recorded_at: string
          target_temp: number
        }
        Insert: {
          controller_id: string
          cooling_enabled: boolean
          created_at?: string
          current_temp: number
          id?: string
          recorded_at?: string
          target_temp: number
        }
        Update: {
          controller_id?: string
          cooling_enabled?: boolean
          created_at?: string
          current_temp?: number
          id?: string
          recorded_at?: string
          target_temp?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_share_id: { Args: { length?: number }; Returns: string }
      get_temp_history_sampled: {
        Args: {
          p_controller_id: string
          p_end_time: string
          p_sample_interval_minutes?: number
          p_start_time: string
        }
        Returns: {
          cooling_enabled: boolean
          current_temp: number
          recorded_at: string
          target_temp: number
        }[]
      }
      trigger_auto_cooling_adjustment: { Args: never; Returns: undefined }
      trigger_brew_sync: { Args: never; Returns: undefined }
      trigger_custom_brew_sync: { Args: never; Returns: undefined }
      trigger_external_timer_sync: { Args: never; Returns: undefined }
      trigger_fermentation_profile_processing: {
        Args: never
        Returns: undefined
      }
      trigger_full_brew_sync: { Args: never; Returns: undefined }
      trigger_rapt_quick_sync: { Args: never; Returns: undefined }
      trigger_sonos_now_playing_sync: { Args: never; Returns: undefined }
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
