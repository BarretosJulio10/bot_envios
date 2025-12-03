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
      blacklist: {
        Row: {
          created_at: string
          id: string
          number_ids: string | null
          phone: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          number_ids?: string | null
          phone: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          number_ids?: string | null
          phone?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          completed_at: string | null
          created_at: string
          failed_count: number
          id: string
          name: string
          sent_count: number
          status: string
          total_numbers: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          failed_count?: number
          id?: string
          name: string
          sent_count?: number
          status?: string
          total_numbers?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          failed_count?: number
          id?: string
          name?: string
          sent_count?: number
          status?: string
          total_numbers?: number
          user_id?: string
        }
        Relationships: []
      }
      evolution_config: {
        Row: {
          base_url: string
          connection_status: string | null
          created_at: string
          delay_max: number | null
          delay_min: number | null
          id: string
          instance_created: boolean | null
          instance_id: string
          pause_after: number | null
          pause_duration: number | null
          qr_code: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_url: string
          connection_status?: string | null
          created_at?: string
          delay_max?: number | null
          delay_min?: number | null
          id?: string
          instance_created?: boolean | null
          instance_id: string
          pause_after?: number | null
          pause_duration?: number | null
          qr_code?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_url?: string
          connection_status?: string | null
          created_at?: string
          delay_max?: number | null
          delay_min?: number | null
          id?: string
          instance_created?: boolean | null
          instance_id?: string
          pause_after?: number | null
          pause_duration?: number | null
          qr_code?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      group_messages: {
        Row: {
          attempts: number | null
          caption: string | null
          created_at: string
          error_message: string | null
          file_type: string | null
          group_id: string
          group_name: string
          id: string
          image_url: string | null
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number | null
          caption?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          group_id: string
          group_name: string
          id?: string
          image_url?: string | null
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number | null
          caption?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          group_id?: string
          group_name?: string
          id?: string
          image_url?: string | null
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          attempts: number | null
          campaign_id: string | null
          created_at: string
          error_message: string | null
          evolution_msg_id: string | null
          file_url: string | null
          filename: string
          id: string
          message_text: string | null
          phone: string
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number | null
          campaign_id?: string | null
          created_at?: string
          error_message?: string | null
          evolution_msg_id?: string | null
          file_url?: string | null
          filename: string
          id?: string
          message_text?: string | null
          phone: string
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number | null
          campaign_id?: string | null
          created_at?: string
          error_message?: string | null
          evolution_msg_id?: string | null
          file_url?: string | null
          filename?: string
          id?: string
          message_text?: string | null
          phone?: string
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_group_lists: {
        Row: {
          created_at: string
          group_ids: Json
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_ids: Json
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_ids?: Json
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_lists: {
        Row: {
          contacts: Json
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contacts: Json
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contacts?: Json
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_files: { Args: never; Returns: undefined }
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
