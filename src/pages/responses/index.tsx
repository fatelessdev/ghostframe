import {
  ResponseLength,
  LanguageSelector,
  AutoScrollToggle,
  TextSize,
  HighContrastToggle,
  PanelSize,
} from "./components";
import { PageLayout } from "@/layouts";

const Responses = () => {
  return (
    <PageLayout
      title="Response Settings"
      description="Customize how AI generates and displays responses"
    >
      <PanelSize />
      <TextSize />
      <HighContrastToggle />

      {/* Response Length */}
      <ResponseLength />

      {/* Language Selector */}
      <LanguageSelector />

      {/* Auto-Scroll Toggle */}
      <AutoScrollToggle />
    </PageLayout>
  );
};

export default Responses;
