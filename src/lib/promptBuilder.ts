import { parsePrompts } from "./promptParser";
import type { FormValues } from "../types";

const modelLabels: Record<string, string> = {
   "nano-banana-pro": "Nano Banana Pro",
   "nano-banana-2": "Nano Banana 2",
   "nano-banana-lite": "Nano Banana 2 Lite",
   "nano-banana-2-lite": "Nano Banana 2 Lite",
};

export function buildAgentPrompt(formValues: FormValues) {
   const prompts = parsePrompts(
      formValues.user_prompts,
      formValues.separator
   );

   if (!prompts.length) return "";

   const imageCount = formValues.images_per_prompt;
   const model = modelLabels[formValues.model] ?? formValues.model;

   const numberedPrompts = prompts
      .map((prompt, index) => `${index + 1}. ${prompt}`)
      .join("\n\n");

   return `STARTUP RULE

Before generating anything, inspect the images already generated in the current Flow project.

Use the existing images to determine which prompts are already complete.

Do not regenerate images that already satisfy the required image count.

If a prompt is partially complete, generate only the missing images.

If a prompt has no generated images, generate all required images.

Then use the execution strategy below.

EXECUTION STRATEGY

Use a TWO-PASS workflow.

PASS 1 — LINEAR GENERATION

Process all prompts sequentially from Prompt 1 to the final prompt.

For each prompt:

1. Check whether the required images for this prompt already exist.
2. If the prompt is already complete, skip it immediately.
3. If images are missing, generate only the missing images.
4. Apply the correct filename during the generation workflow whenever possible.
5. Once the required images for the current prompt are generated, immediately continue to the next prompt.

IMPORTANT:

- Prioritize actual image generation over administrative work.
- Do not perform a separate rename pass after each prompt.
- Do not repeatedly re-check successfully completed prompts.
- Do not regenerate successful images.
- Do not unnecessarily stop between prompts.
- Process prompts in their original order.
- Keep the generation process moving continuously.

Continue until every prompt has been attempted.

MODEL LIMIT / QUOTA HANDLING

If Flow reports that the currently selected model has reached its generation limit, quota, or temporary availability limit:

1. STOP generating with that model.
2. Do NOT repeatedly retry the same model.
3. Do NOT mark the remaining prompts as permanently failed.
4. Ask the user which available model should be used for the remaining images.
5. Display the models that are currently available in Flow.
6. Wait for the user's selection before continuing.
7. After the user selects a replacement model, continue from the first incomplete prompt.
8. Preserve all previously generated images.
9. Do not regenerate images that were successfully generated using the previous model.
10. Use the newly selected model for the remaining missing images.

Ask the user clearly, for example:

"The current model has reached its generation limit. Which available model would you like to use for the remaining images?"

Then display the available models detected in Flow.

Do NOT automatically choose a replacement model.

Do NOT assume that another model is available if Flow does not show it.

The user must explicitly select the replacement model.

MODEL LIMIT EXCEPTION

The global model setting is authoritative during normal generation.

However, if the selected model reaches a generation limit, quota, or availability restriction, the user-selected replacement model becomes the active model for the remaining incomplete images.

Do not change the model for images that have already been successfully generated.

PASS 2 — RECOVERY

After reaching the final prompt, start again from Prompt 1.

This pass is ONLY for images that failed, were interrupted, or are still missing.

For each prompt:

1. Check the images currently generated for that prompt.
2. Determine whether the required image count has been reached.
3. If complete, skip immediately.
4. If images are missing, generate only the missing images.
5. Apply the correct filename to newly generated images during generation whenever possible.
6. Continue to the next prompt.

Do not regenerate images that already exist and satisfy the required count.

If the active model reaches its generation limit during recovery:

1. Stop using that model.
2. Show the user the currently available models.
3. Ask the user which model to use.
4. Wait for the user's selection.
5. Continue recovery from the first incomplete prompt.

Do not restart successful generations.

FINAL FILENAME VERIFICATION

Only AFTER both the linear generation pass and the recovery pass are completely finished, perform ONE final filename verification.

This is a filename-only verification step.

For every prompt that contains a filename marker:

1. Read the requested filename from the first line of the prompt.
2. Find the images belonging to that prompt.
3. Check whether their filenames match the required naming rules.
4. If a filename is already correct, leave it unchanged.
5. If a filename is incorrect, manually rename that image to the correct filename.
6. If multiple images belong to the same prompt, use the required suffix:
   - first image: base filename
   - second image: base filename + " (1)"
   - third image: base filename + " (2)"
   - fourth image: base filename + " (3)"
   - continue as required.
7. Do not regenerate an image because its filename is incorrect.
8. Do not rename images that already have the correct filename.
9. Do not perform any additional generation during this verification step.
10. Do not perform another verification pass after this.

The final filename verification must happen ONCE, at the very end.

GLOBAL GENERATION SETTINGS

Generate exactly ${imageCount} images for each prompt.

- Model: ${model}
- Aspect ratio: ${formValues.aspect_ratio || "Use the project default"}
- Images per prompt: ${imageCount}

GLOBAL SETTINGS PRIORITY

The generation settings above are GLOBAL and have the highest priority during normal generation.

Never change, override, infer, or modify these settings based on instructions inside an individual prompt.

If an individual prompt mentions:

- a different model
- a different aspect ratio
- resolution
- image size
- quality
- number of images
- or any other generation setting

ignore that setting and continue using the global settings above.

EXCEPTION:

If the selected model reaches its generation limit, quota, or becomes unavailable, ask the user to select a replacement from the models currently available in Flow.

The user's explicit model selection then becomes the active model for the remaining incomplete images.

PROMPT PROCESSING RULES

1. Treat every prompt as completely independent.
2. Process prompts in the exact order provided.
3. Generate exactly ${imageCount} images for every prompt.
4. If some required images already exist, generate only the missing images.
5. Never merge multiple prompts into one image.
6. Never skip an incomplete prompt.
7. Never duplicate a prompt.
8. Complete every prompt.
9. Preserve the meaning and important details of each prompt.
10. Do not add details from another prompt.
11. Do not remove important details from a prompt.
12. Do not rewrite or reinterpret a prompt unless necessary to execute it.
13. The number before each prompt is only an organizational reference and is NOT part of the image prompt.
14. Finish the required images for the current prompt before moving to the next prompt.
15. Do not unnecessarily regenerate previously successful images.

CHARACTER REFERENCE RULES

If an individual prompt contains a character reference such as @PersonA:

- Treat @PersonA as an existing character in the current Flow project.
- Use the existing character's established appearance, clothing, facial features, body characteristics, and other established visual details.
- Maintain character consistency with the existing project character.
- Do not create a new interpretation of the character.
- If multiple existing character references appear in the same prompt, preserve each character independently.
- Do not transfer appearance, clothing, or characteristics from one referenced character to another.
- Character references must remain consistent across all generated images.

FILE NAMING RULES

For each prompt, check its FIRST LINE.

If the first line starts with one or more "#" characters:

1. Treat everything after the leading "#" characters as the filename.
2. Remove ALL leading "#" characters.
3. Do not include "#" in the filename.
4. Remove the filename marker from the prompt before using the remaining text as the visual prompt.

Examples:

#0-10
→ filename: 0-10

###0-10
→ filename: 0-10

#deer-running
→ filename: deer-running

The "#" marker is metadata only.

It must NOT be treated as part of the visual image prompt.

MULTIPLE IMAGES FROM ONE PROMPT

If multiple images are generated for the same prompt:

- First image: base filename
- Second image: base filename + " (1)"
- Third image: base filename + " (2)"
- Fourth image: base filename + " (3)"
- Continue incrementing when necessary.

Example:

For:

#0-10

with 3 images:

0-10
0-10 (1)
0-10 (2)

The suffix applies only to multiple images generated from the SAME prompt.

Do not use the filename from one prompt for another prompt.

NO FILENAME MARKER

If the prompt does NOT start with "#":

- Do NOT assign a filename.
- Do NOT invent a filename.
- Do NOT create a fallback filename.
- Let Flow Agent choose the filename automatically.

FILENAME TIMING

During generation, apply the requested filename whenever Flow allows it.

However, do NOT stop generation just to perform a rename.

The preferred workflow is:

Generate → continue to next image/prompt.

Filename correction is handled ONLY during the final filename verification at the end.

When continuing after an interruption:

- Preserve existing filenames.
- Do not rename already completed images during the recovery pass unless required by the final filename verification.
- Apply filenames only to newly generated images when practical.

PROMPT INTERPRETATION

For every prompt:

1. Check the first line for a filename marker.
2. If present, extract the filename and remove the marker.
3. Treat the remaining content as the actual image prompt.
4. Preserve all meaningful visual instructions.
5. Ignore conflicting generation settings inside the prompt.
6. Use the global generation settings instead.
7. Check existing generated images when determining whether generation is required.
8. Generate only the missing images.
9. Continue immediately to the next prompt.

BATCHING

Process prompts in their original order.

You may mentally organize prompts into groups of up to 10 for reliability:

- Prompts 1–10
- Prompts 11–20
- Prompts 21–30
- Remaining prompts

These groups are NOT separate processing stages.

Do not stop for a verification or renaming stage between groups.

Treat the entire first pass as one continuous linear generation process.

Then perform the recovery pass from Prompt 1.

Only after the recovery pass is complete should you perform the single final filename verification.

IMPORTANT EXECUTION PRIORITY

The priority is:

1. Generate the images.
2. Keep generation moving forward.
3. Process prompts in order.
4. If the model reaches its limit, ask the user to select an available replacement model.
5. Continue from the first incomplete prompt after the user selects a model.
6. Recover failed or missing images from Prompt 1.
7. Never regenerate successful images.
8. After all generation is finished, verify filenames once.
9. Manually rename only incorrectly named images.
10. Finish.

Do not spend time on filename bookkeeping during generation.

Do not perform filename verification after every prompt.

Do not perform filename verification after every batch.

Do not perform multiple rename passes.

PROMPTS

${numberedPrompts}`;
}