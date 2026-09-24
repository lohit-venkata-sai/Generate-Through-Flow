import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../../@/components/ui/accordion";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "../../@/components/ui/select";
import { Settings2 } from "lucide-react";
import type { FormValues } from "../types";

interface SettingsAccordionProps {
    formValues: FormValues;
    setFormValues: React.Dispatch<React.SetStateAction<FormValues>>;
}

const Settings = [
    {
        title: "Generation Settings",
        selections: [
            {
                id: "model",
                label: "Model",
                options: [
                    {
                        icon: "Banana",
                        value: "nano-banana-pro",
                        label: "🍌 Nano Banana Pro",
                    },
                    {
                        icon: "Banana",
                        value: "nano-banana-2",
                        label: "🍌 Nano Banana 2",
                    },
                    {
                        icon: "Banana",
                        value: "nano-banana-2-lite",
                        label: "🍌 Nano Banana 2 Lite",
                    },
                ],
            },
            {
                id: "aspect_ratio",
                label: "Aspect Ratio",
                control: "options",
                options: [
                    {
                        icon: "RectangleVertical",
                        value: "9:16",
                        label: "9:16",
                    },
                    {
                        icon: "RectangleVertical",
                        value: "16:9",
                        label: "16:9",
                    },
                    {
                        icon: "Square",
                        value: "1:1",
                        label: "1:1",
                    },
                ],
            },
            {
                id: "images_per_prompt",
                label: "Images per prompt",
                control: "options",
                options: [
                    { value: "1", label: "1×" },
                    { value: "2", label: "2×" },
                    { value: "3", label: "3×" },
                    { value: "4", label: "4×" },
                ],
            },
        ],
    },
    // Output settings will return in a later version.
];

export function SettingsAccordion({
    formValues,
    setFormValues,
}: SettingsAccordionProps) {
    const handleOnChangeSelection = (
        id: string,
        value: string | null
    ) => {
        if (value === null) return;

        setFormValues((prev) => ({
            ...prev,
            [id]: id === "images_per_prompt" ? Number(value) as 1 | 2 | 3 | 4 : value,
        }));
    };

    return (
        <Accordion
            defaultValue={Settings.map((setting) => setting.title)}
            className="w-full"
        >
            {Settings.map((setting) => (
                <AccordionItem
                    key={setting.title}
                    value={setting.title}
                >
                    <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
                        <span className="flex items-center gap-2.5 text-sm font-semibold">
                            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Settings2 className="size-4" />
                            </span>
                            {setting.title}
                        </span>
                    </AccordionTrigger>

                    <AccordionContent className="space-y-6 px-4 pb-5 pt-2">
                        {setting.selections.map((selection) => (
                            <div
                                key={selection.id}
                                className="space-y-2.5"
                            >
                                <label className="text-sm font-medium">
                                    {selection.label}
                                </label>

                                {selection.control === "options" ? (
                                    <div className={`grid gap-2 ${selection.id === "aspect_ratio" ? "grid-cols-3" : "grid-cols-4"}`} role="group" aria-label={selection.label}>
                                        {selection.options.map((option) => {
                                            const isSelected = String(formValues[selection.id as keyof FormValues]) === option.value;

                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    aria-pressed={isSelected}
                                                    onClick={() => handleOnChangeSelection(selection.id, option.value)}
                                                    className={`h-10 rounded-xl border px-3 text-sm font-medium transition-colors ${isSelected
                                                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                                        : "bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                                                        }`}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <Select
                                        value={formValues[selection.id as keyof FormValues] as string}
                                        onValueChange={(value) =>
                                            handleOnChangeSelection(
                                                selection.id,
                                                value as string | null
                                            )
                                        }
                                    >
                                        <SelectTrigger className="h-10 w-full bg-background">
                                            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                                {selection.options.find((option) => option.value === formValues[selection.id as keyof FormValues])?.label ?? `Select ${selection.label}`}
                                            </span>
                                        </SelectTrigger>

                                        <SelectContent>
                                            {selection.options.map((option) => (
                                                <SelectItem
                                                    key={option.value}
                                                    value={option.value}
                                                >
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        ))}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    );
}
