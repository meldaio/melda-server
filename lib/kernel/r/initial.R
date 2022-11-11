library(jsonlite)
.rcultureGlobals <- function() {
  r = lapply(ls(envir = .GlobalEnv), function(name) {
    stringify = c("numeric", "character", "logical")
    var = get(name, envir = .GlobalEnv)
    type = class(var)
    content = NULL
    if (type %in% stringify) {
      content = toString(var, 25)
    }
    if(name != ".rcultureGlobals")
      list(
        name = name,
        type = type,
        content = content
      )
    else
      list()
  })
  l_idx <- sapply(r, length)
  r <- r[l_idx>0]
  ##toJSON(r, auto_unbox = T, pretty = T, null = "null")
  r
}


.meldaDependencies <- function(input){
  return (list())
}


#if( "meldaioutils" %in% rownames( installed.packages() )) {
#library(meldaioutils) 
#.meldaDependencies <- function(input){
#  defaultLibs <- sessionInfo()
#  defaultLibs <- c(defaultLibs$basePkgs,names(defaultLibs$otherPkgs))
#  funcNames <- melda.findFunctionName( input )
#  allDeps <- list()
#  for(func in funcNames){
#    dep <- melda.findLibraryInDefPkgs(func)
#    allDeps <- append(allDeps,list(list(method  = dep$funcName ,
#                                        package = dep$libName
#    )))
#  }
#  if(length(allDeps) == 0 ){
#    return(list())
#  }else{
#    #toJSON(allDeps,auto_unbox = T,pretty = T)
#    allDeps
#  }
#} 
#}else{
#  .meldaDependencies <- function(input){
#    return (list())
#  }
#}
