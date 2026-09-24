export type PromptSeparator = "empty-line" | "new-line" | "numbered" | "";

export interface FormValues {
    model: string;
    aspect_ratio: string;
    file_name_pattern: string;
    images_per_prompt: 1 | 2 | 3 | 4;
    separator: PromptSeparator;
    user_prompts: string;
    total_prompts: number;
}
