import { createRoot } from "react-dom/client";
import "./index.css";
import { BrewDayCard } from "./components/brew-card/BrewDayCard";
const day: any = { recipe_name: "El Sueco Dorado v5", step_title: "Kok", step_index: 3, step_count: 6, target_temp_c: 100, next_step_title: "Whirlpool", next_step_minutes: 20, next_step_items: 2,
  items: [{id:"a",name:"Magnum",amount:25,unit:"g",at_min:60,checked:true},{id:"b",name:"Citra",amount:30,unit:"g",at_min:15,checked:false},{id:"c",name:"Irish moss",amount:5,unit:"g",at_min:10,checked:false},{id:"d",name:"Mosaic Cryo",amount:40,unit:"g",at_min:0,checked:false}] };
const w = Number(new URLSearchParams(location.search).get("w"));
const h = Number(new URLSearchParams(location.search).get("h"));
createRoot(document.getElementById("r")!).render(<div style={{width:w,height:h,padding:8}}><BrewDayCard day={day} isTvMode compact={location.search.includes("c=1")} /></div>);
