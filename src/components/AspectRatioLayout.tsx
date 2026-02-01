import { Outlet } from "react-router-dom";
import { AspectRatioContainer } from "@/components/AspectRatioContainer";
import { TimerFooter } from "@/components/TimerFooter";

/**
 * Layout component that wraps child routes with AspectRatioContainer and TimerFooter.
 * Uses React Router's Outlet pattern for proper nested routing.
 */
export const AspectRatioLayout = () => {
  return (
    <AspectRatioContainer>
      <Outlet />
      <TimerFooter />
    </AspectRatioContainer>
  );
};
