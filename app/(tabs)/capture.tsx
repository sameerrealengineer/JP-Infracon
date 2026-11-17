import { Redirect } from "expo-router";

/** The "+" tab never shows its own page: the tab button opens /capture (see _layout). */
export default function CaptureTab() {
  return <Redirect href={"/capture" as never} />;
}
