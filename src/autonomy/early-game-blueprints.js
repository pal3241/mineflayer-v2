const block = (x,y,z,name,properties={}) => ({ x,y,z,name,properties });

function shell({ width, depth, height, floor='cobblestone', wall='oak_planks', roof='oak_planks' }) {
  const blocks=[];
  for(let x=0;x<width;x++)for(let z=0;z<depth;z++)blocks.push(block(x,0,z,floor));
  for(let y=1;y<height;y++)for(let x=0;x<width;x++)for(let z=0;z<depth;z++)if(x===0||z===0||x===width-1||z===depth-1){if(!(z===0&&x===Math.floor(width/2)&&y<=2))blocks.push(block(x,y,z,wall));}
  for(let x=0;x<width;x++)for(let z=0;z<depth;z++)blocks.push(block(x,height,z,roof));
  return blocks;
}

export const EARLY_GAME_BLUEPRINTS = Object.freeze([
  { templateId:'early-shelter-v1', category:'HOUSE', earlyGameValue:110, craftBurden:1, stage:'STONE', name:'MineHive Early Shelter', width:5, depth:5, height:5, blocks:[...shell({width:5,depth:5,height:4}),block(2,1,0,'oak_door',{facing:'north',half:'lower',open:false}),block(1,1,1,'torch'),block(3,1,3,'torch')] },
  { templateId:'early-warehouse-v1', category:'STOREHOUSE', earlyGameValue:105, craftBurden:2, stage:'STONE', name:'MineHive Early Storehouse', width:7, depth:5, height:5, blocks:[...shell({width:7,depth:5,height:4}),block(3,1,0,'oak_door',{facing:'north',half:'lower',open:false}),block(1,1,1,'chest'),block(2,1,1,'chest'),block(4,1,1,'chest'),block(5,1,1,'chest'),block(1,1,3,'torch'),block(5,1,3,'torch')] },
  { templateId:'early-crop-farm-v1', category:'CROP_FARM', earlyGameValue:90, craftBurden:1, stage:'STONE', name:'MineHive Starter Crop Farm', width:7, depth:7, height:2, blocks:[...farmBorder(7,7,'cobblestone'),block(3,0,0,'oak_fence_gate',{facing:'south',open:false}),block(1,0,1,'composter'),block(5,0,5,'chest')] },
  { templateId:'early-tree-farm-v1', category:'TREE_FARM', earlyGameValue:85, craftBurden:0, stage:'STONE', name:'MineHive Starter Tree Grove', width:9, depth:9, height:1, blocks:treeMarkers(9,9,'cobblestone') },
  { templateId:'early-bedroom-v1', category:'HOUSE', earlyGameValue:82, craftBurden:2, stage:'IRON', name:'MineHive Early Bedroom', width:5, depth:5, height:5, blocks:[...shell({width:5,depth:5,height:4}),block(2,1,0,'oak_door',{facing:'north',half:'lower',open:false}),block(2,1,2,'white_bed',{facing:'south',part:'foot',occupied:false}),block(1,1,1,'torch'),block(3,1,3,'torch')] },
  { templateId:'early-workshop-v1', category:'WORKSHOP', earlyGameValue:80, craftBurden:3, stage:'IRON', name:'MineHive Early Workshop', width:5, depth:5, height:5, blocks:[...shell({width:5,depth:5,height:4}),block(2,1,0,'oak_door',{facing:'north',half:'lower',open:false}),block(1,1,1,'crafting_table'),block(2,1,1,'furnace'),block(3,1,1,'chest'),block(1,1,3,'torch'),block(3,1,3,'torch')] }
]);

export function blueprintInput(template){return {name:template.name,format:'minehive-json',origin:{x:0,y:0,z:0},blocks:template.blocks,metadata:{trustedBuiltin:true,automaticInfrastructure:true,templateId:template.templateId,category:template.category,earlyGameValue:template.earlyGameValue,craftBurden:template.craftBurden,requiredStage:template.stage,footprint:{width:template.width,depth:template.depth,height:template.height}}};}

function farmBorder(width,depth,name){const blocks=[];for(let x=0;x<width;x++)for(let z=0;z<depth;z++)if(x===0||z===0||x===width-1||z===depth-1)blocks.push(block(x,0,z,name));return blocks;}
function treeMarkers(width,depth,name){const blocks=[];for(let x=0;x<width;x+=4)for(let z=0;z<depth;z+=4)blocks.push(block(x,0,z,name));return blocks;}
