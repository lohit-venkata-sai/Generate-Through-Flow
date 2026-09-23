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
    SelectValue,
} from "../../@/components/ui/select";

interface FormValues {
    model: string;
    aspect_ratio: string;
    file_name_pattern: string;
    separator: string;
    user_prompts: string;
    total_prompts: number;
}

interface SettingsAccordionProps {
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
                        label: "Nano Banana Pro",
                    },
                    {
                        icon: "Banana",
                        value: "nano-banana-2",
                        label: "Nano Banana 2",
                    },
                    {
                        icon: "Banana",
                        value: "nano-banana-lite",
                        label: "Nano Banana Lite",
                    },
                ],
            },
            {
                id: "aspect_ratio",
                label: "Aspect Ratio",
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
        ],
    },
    {
        title: "Output Settings",
        selections: [
            {
                id: "file_name_pattern",
                label: "File name pattern",
                options: [
                    {
                        icon: "",
                        value: "mm-ss",
                        label: "mm-ss",
                    },
                ],
            },
        ],
    },
];

export function SettingsAccordion({
    setFormValues,
}: SettingsAccordionProps) {
    const handleOnChangeSelection = (
        id: string,
        value: string | null
    ) => {
        if (value === null) return;

        setFormValues((prev) => ({
            ...prev,
            [id]: value,
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
                    <AccordionTrigger>
                        {setting.title}
                    </AccordionTrigger>

                    <AccordionContent className="space-y-4 p-2">
                        {setting.selections.map((selection) => (
                            <div
                                key={selection.id}
                                className="space-y-2"
                            >
                                <label className="text-sm font-medium">
                                    {selection.label}
                                </label>

                                <Select
                                    onValueChange={(value) =>
                                        handleOnChangeSelection(
                                            selection.id,
                                            value as string | null
                                        )
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue
                                            placeholder={`Select ${selection.label}`}
                                        />
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
                            </div>
                        ))}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    );
}