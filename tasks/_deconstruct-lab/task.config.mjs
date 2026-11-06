export default {
  title:'解构实验 · 分离 / 观察 / 重组',
  width:1920,height:1080,fps:60,captions:false,
  style:{name:'noir',post:{grain:0,vignette:.12,ca:0,contrast:1,saturation:1,bloom:.12}},
  palette:{ink:'#17212b',ink2:'#202e3a',bone:'#eeeae2',ash:'#a6abb0',signal:'#fa783d',ember:'#ffb47c',blood:'#763b20',acid:'#ffa470'},
  timeline:[{
    type:'deconstruct',id:'deconstruct',dur:10.8,world:false,
    title:'拆开，才看见结构',label:'分离 · 观察 · 重组',
    state:{from:['assembled-cube'],to:['assembled-cube'],diff:['space','ownership','light']},
  }],
};
