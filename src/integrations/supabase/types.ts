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
      brew_readings: {
        Row: {
          abv: number
          attenuation: number
          batch_id: string
          batch_number: string
          battery: number | null
          created_at: string
          current_sg: number
          current_temp: number
          final_gravity: number
          id: string
          last_update: string | null
          name: string
          original_gravity: number
          sg_data: Json
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
          created_at?: string
          current_sg: number
          current_temp: number
          final_gravity: number
          id?: string
          last_update?: string | null
          name: string
          original_gravity: number
          sg_data?: Json
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
          created_at?: string
          current_sg?: number
          current_temp?: number
          final_gravity?: number
          id?: string
          last_update?: string | null
          name?: string
          original_gravity?: number
          sg_data?: Json
          status?: string
          style?: string
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
          created_at: string
          current_temp: number | null
          heating_enabled: boolean | null
          heating_utilisation: number | null
          id: string
          last_update: string | null
          name: string
          target_temp: number | null
          updated_at: string
        }
        Insert: {
          controller_id: string
          cooling_enabled?: boolean | null
          created_at?: string
          current_temp?: number | null
          heating_enabled?: boolean | null
          heating_utilisation?: number | null
          id?: string
          last_update?: string | null
          name: string
          target_temp?: number | null
          updated_at?: string
        }
        Update: {
          controller_id?: string
          cooling_enabled?: boolean | null
          created_at?: string
          current_temp?: number | null
          heating_enabled?: boolean | null
          heating_utilisation?: number | null
          id?: string
          last_update?: string | null
          name?: string
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
          id: string
          is_visible: boolean
          pill_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          pill_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
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
          id: string
          is_visible: boolean
          updated_at: string
        }
        Insert: {
          controller_id: string
          created_at?: string
          id?: string
          is_visible?: boolean
          updated_at?: string
        }
        Update: {
          controller_id?: string
          created_at?: string
          id?: string
          is_visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      sync_settings: {
        Row: {
          auto_activate_fermenting: boolean | null
          auto_hide_completed: boolean | null
          auto_hide_conditioning: boolean | null
          created_at: string
          full_sync_interval: number | null
          id: string
          last_full_sync_at: string | null
          last_rapt_quick_sync_at: string | null
          last_rapt_sync_at: string | null
          last_sync_at: string | null
          last_sync_time: string | null
          rapt_sync_interval: number
          sync_interval: number
          updated_at: string
        }
        Insert: {
          auto_activate_fermenting?: boolean | null
          auto_hide_completed?: boolean | null
          auto_hide_conditioning?: boolean | null
          created_at?: string
          full_sync_interval?: number | null
          id?: string
          last_full_sync_at?: string | null
          last_rapt_quick_sync_at?: string | null
          last_rapt_sync_at?: string | null
          last_sync_at?: string | null
          last_sync_time?: string | null
          rapt_sync_interval?: number
          sync_interval?: number
          updated_at?: string
        }
        Update: {
          auto_activate_fermenting?: boolean | null
          auto_hide_completed?: boolean | null
          auto_hide_conditioning?: boolean | null
          created_at?: string
          full_sync_interval?: number | null
          id?: string
          last_full_sync_at?: string | null
          last_rapt_quick_sync_at?: string | null
          last_rapt_sync_at?: string | null
          last_sync_at?: string | null
          last_sync_time?: string | null
          rapt_sync_interval?: number
          sync_interval?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      trigger_brew_sync: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      trigger_full_brew_sync: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      trigger_rapt_quick_sync: {
        Args: Record<PropertyKey, never>
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
