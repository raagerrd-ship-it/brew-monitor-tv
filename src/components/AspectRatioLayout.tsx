import { Outlet } from "react-router-dom";
import { AspectRatioContainer } from "@/components/AspectRatioContainer";

/**
 * Layout component that wraps child routes with AspectRatioContainer.
 * TimerFooter is now rendered inside BrewingDashboard to avoid duplicate hooks.
 */
export const AspectRatioLayout = () => {
  return (
    <AspectRatioContainer>
      <Outlet />
    </AspectRatioContainer>
  );
};
