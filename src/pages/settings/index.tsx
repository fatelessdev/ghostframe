import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
  DisguiseMode,
} from "./components";
import { PageLayout } from "@/layouts";

const Settings = () => {
  return (
    <PageLayout title="Settings" description="Manage your settings">
      {/* Theme */}
      <Theme />

      {/* Autostart Toggle */}
      <AutostartToggle />

      {/* App Icon Toggle */}
      <AppIconToggle />

      {/* Always On Top Toggle */}
      <AlwaysOnTopToggle />

      {/* Window Disguise */}
      <DisguiseMode />
    </PageLayout>
  );
};

export default Settings;
